package io.cinessd.android;
import android.app.Activity;
import android.content.*;
import androidx.core.content.ContextCompat;
import androidx.documentfile.provider.DocumentFile;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

final class Transfers {
    private static Transfers instance;
    static synchronized Transfers get(Context context) { if(instance==null)instance=new Transfers(context.getApplicationContext()); return instance; }
    private final Context context;
    private final PrivateDocuments documents;
    private final File root;
    private final List<JSONObject> jobs=new ArrayList<>();
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private Consumer<JSObject> events=event -> {};
    private boolean running;
    private volatile HttpURLConnection connection;
    private String startupError;
    private String destination;
    private Transfers(Context context) {
        this.context=context;documents=new PrivateDocuments(context);root=new File(context.getExternalFilesDir(null),"downloads");root.mkdirs();destination=root.toURI().toString();
        try { String saved=documents.read("download-destination");if(saved!=null)destination=new JSONObject(saved).getString("uri"); }catch(Exception error){startupError="Não foi possível recuperar a pasta dos downloads.";}
        try { String saved=documents.read("downloads-native"); if(saved!=null) { JSONArray array=new JSONArray(saved); for(int i=0;i<array.length();i++) { JSONObject job=array.getJSONObject(i); if(Arrays.asList("queued","metadata","downloading").contains(job.optString("state")))job.put("state","paused"); jobs.add(job); } } } catch(Exception error) { startupError="A fila salva não pôde ser recuperada. Os arquivos foram preservados."; }
    }
    synchronized void setEvents(Consumer<JSObject> listener) { events=listener; }
    private void save() throws Exception { synchronized(this) { if(startupError!=null)throw new IOException(startupError); documents.write("downloads-native",new JSONArray(jobs).toString()); } }
    private void publish(boolean completed) { events.accept(new JSObject().put("type","downloads").put("completed",completed)); }
    synchronized JSObject snapshot() throws Exception {
        JSArray array=new JSArray(); List<JSONObject> reverse=new ArrayList<>(jobs);Collections.reverse(reverse);
        for(JSONObject job:reverse) { JSONObject value=new JSONObject(job.toString());value.remove("raw");array.put(value); }
        return new JSObject().put("jobs",array).put("root",destination).put("torrentAvailable",true);
    }
    synchronized void destination(String uri) throws Exception {
        DocumentFile folder=DocumentFile.fromTreeUri(context,Uri.parse(uri));if(folder==null || !folder.isDirectory() || !folder.canWrite())throw new IOException("Pasta sem permissão de escrita.");
        documents.write("download-destination",new JSONObject().put("uri",uri).toString());destination=uri;
    }
    synchronized void enqueue(JSArray values) throws Exception {
        if(startupError!=null)throw new IOException(startupError);
        List<JSONObject> pending=new ArrayList<>();
        for(int i=0;i<values.length();i++) { JSONObject raw=values.getJSONObject(i);String folder=raw.getString("folder"),prefix=raw.getString("prefix");
            File directory=new File(root,folder).getCanonicalFile();if(!directory.toPath().startsWith(root.getCanonicalFile().toPath()) || prefix.contains("/") || prefix.contains("\\"))throw new IOException("Pasta inválida.");
            for(JSONObject job:jobs)if(!("completed".equals(job.optString("state")) && !completedExists(job)) && directory.toString().equals(job.optString("directory")) && prefix.equals(job.getJSONObject("raw").optString("prefix")) && !Arrays.asList("cancelled","error").contains(job.optString("state")))throw new IOException("Este título já está na fila ou foi baixado.");
            JSONObject job=new JSONObject().put("id",raw.getString("id")).put("title",raw.getString("title")).put("itemName",raw.getString("itemName")).put("sourceName",raw.getString("sourceName")).put("state","queued").put("downloaded",0).put("total",0).put("speed",0).put("peers",0).put("root",destination).put("directory",directory.toString()).put("fileName","").put("createdAt",java.time.Instant.now().toString()).put("raw",raw);
            if(raw.has("season"))job.put("season",raw.getInt("season"));if(raw.has("episode"))job.put("episode",raw.getInt("episode"));pending.add(job);
        }
        jobs.addAll(pending);try { save(); }catch(Exception error) { jobs.removeAll(pending);throw error; }publish(false);pump();
    }
    synchronized void control(String action,String id,Activity activity) throws Exception {
        JSONObject job=jobs.stream().filter(value -> id.equals(value.optString("id"))).findFirst().orElseThrow(() -> new IOException("Download não encontrado."));
        if("reveal".equals(action)) { if(job.has("resultUri")){ Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(job.getString("resultUri")),job.optString("mime","application/octet-stream")).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.runOnUiThread(() -> activity.startActivity(intent));return; } File file=new File(job.getString("directory"),job.getString("fileName"));UriOpen.open(context,activity,file);return; }
        if("completed".equals(job.optString("state")))throw new IOException("Este download já está concluído.");
        if("resume".equals(action)) { if("cancelled".equals(job.optString("state")))throw new IOException("Escolha a fonte novamente.");job.put("state","queued");job.remove("error");save();publish(false);pump();return; }
        if(!Arrays.asList("pause","cancel").contains(action))throw new IOException("Ação inválida.");job.put("state","pause".equals(action)?"paused":"cancelled");save();publish(false);
    }
    synchronized void pauseAll() { try { for(JSONObject job:jobs)if(Arrays.asList("queued","metadata","downloading").contains(job.optString("state")))job.put("state","paused"); if(connection!=null)connection.disconnect();save();publish(false); }catch(Exception ignored){} }
    private boolean cancelled(JSONObject job) { return Arrays.asList("paused","cancelled").contains(job.optString("state")); }
    private synchronized void pump() {
        if(running)return;JSONObject next=jobs.stream().filter(job -> "queued".equals(job.optString("state"))).findFirst().orElse(null);if(next==null)return;running=true;
        ContextCompat.startForegroundService(context,new Intent(context,TransferService.class));
        worker.submit(() -> { try {
            JSONObject raw=next.getJSONObject("raw");File directory=new File(next.getString("directory"));directory.mkdirs();
            File ready=new File(directory,next.optString("fileName",".missing"));
            if(!ready.isFile() || next.optLong("total")==0 || ready.length()!=next.optLong("total")) { if(raw.has("infoHash"))torrent(next,raw,directory);else http(next,raw,directory); }
            if(!cancelled(next)) { publishFile(next);next.put("state","completed");next.remove("error");next.put("speed",0);next.put("peers",0);save();publish(true); }
        } catch(Exception error) { try { if(!cancelled(next)) { next.put("state","error");next.put("error",error.getMessage()==null?"Falha no download.":error.getMessage()); } save(); }catch(Exception ignored){} publish(false);
        } finally { synchronized(this) { running=false; } context.stopService(new Intent(context,TransferService.class));pump(); } });
    }
    private boolean completedExists(JSONObject job) {
        if(job.has("resultUri")){DocumentFile file=DocumentFile.fromSingleUri(context,Uri.parse(job.optString("resultUri")));return file!=null && file.exists();}
        return new File(job.optString("directory"),job.optString("fileName")).exists();
    }
    private void publishFile(JSONObject job) throws Exception {
        String uri=job.getString("root");if(!uri.startsWith("content:"))return;
        DocumentFile folder=DocumentFile.fromTreeUri(context,Uri.parse(uri));if(folder==null)throw new IOException("Reconecte a pasta de destino.");
        for(String segment:job.getJSONObject("raw").getString("folder").split("/")) { DocumentFile child=folder.findFile(segment);if(child==null)child=folder.createDirectory(segment);if(child==null || !child.isDirectory())throw new IOException("Não foi possível criar a pasta do título.");folder=child; }
        File source=new File(job.getString("directory"),job.getString("fileName"));String name=source.getName();if(folder.findFile(name)!=null)throw new IOException("O destino já existe e foi preservado.");
        String mime=URLConnection.guessContentTypeFromName(name);if(mime==null)mime="application/octet-stream";
        DocumentFile target=folder.createFile(mime,name);if(target==null)throw new IOException("Não foi possível criar o arquivo.");
        try(InputStream input=new FileInputStream(source);OutputStream output=context.getContentResolver().openOutputStream(target.getUri())) { if(output==null)throw new IOException("Destino indisponível.");byte[] bytes=new byte[65536];int n;while((n=input.read(bytes))!=-1){if(cancelled(job))throw new IOException("Download pausado.");output.write(bytes,0,n);} }
        catch(Exception error){target.delete();throw error;}
        job.put("resultUri",target.getUri().toString()).put("mime",mime);source.delete();
    }
    private void status(JSONObject job,long done,long total,long speed,int peers) throws Exception { job.put("downloaded",done).put("total",total).put("speed",speed).put("peers",peers);if(TransferService.active!=null)TransferService.active.update(job.optString("title"),done,total);save();publish(false); }
    private void http(JSONObject job,JSONObject raw,File directory) throws Exception {
        URL url=Network.url(raw.getString("url"));String filename=raw.optString("filename",URLDecoder.decode(url.getPath(),"UTF-8"));String type=raw.optString("type");
        String pattern="book".equals(type)?"epub|pdf|mobi|azw3|fb2|cbz|cbr|txt":"audiobook".equals(type)?"mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav":"mkv|mp4|avi|webm|m4v|mov|ts|m2ts";
        java.util.regex.Matcher matcher=java.util.regex.Pattern.compile("\\.("+pattern+")$",java.util.regex.Pattern.CASE_INSENSITIVE).matcher(filename);String extension=matcher.find()?matcher.group().toLowerCase(Locale.ROOT):Arrays.asList("movie","series").contains(type)?".mp4":null;
        if(extension==null)throw new IOException("A fonte não informou o formato do arquivo.");
        File target=new File(directory,raw.getString("prefix")+extension),partial=new File(directory,".umbra-"+job.getString("id")+".partial");job.put("fileName",target.getName());if(target.exists())throw new IOException("O arquivo de destino já existe e foi preservado.");
        long offset=partial.exists()?partial.length():0;Map<String,String> headers=UmbraDevicePlugin.headers(raw.optJSONObject("headers")==null?new JSONObject():raw.getJSONObject("headers"));headers.put("Accept-Encoding","identity");if(offset>0)headers.put("Range","bytes="+offset+"-");
        connection=Network.connect(url.toString(),headers);HttpURLConnection active=connection;
        try { int code=active.getResponseCode();
            if(code==416 && offset>0 && ("bytes */"+offset).equals(active.getHeaderField("Content-Range"))) { Files.move(partial.toPath(),target.toPath());status(job,offset,offset,0,0);return; }
            if(code<200 || code>=300)throw new IOException("A fonte recusou o download. Tente outra opção.");
            String mime=Optional.ofNullable(active.getContentType()).orElse("").toLowerCase(Locale.ROOT);if(mime.contains("html") || mime.contains("json") || mime.contains("mpegurl") || mime.contains("dash+xml"))throw new IOException("Esta fonte não é um arquivo direto para download.");
            long total=active.getContentLengthLong();if(code==206) { String range=active.getHeaderField("Content-Range");if(range==null || !range.startsWith("bytes "+offset+"-"))throw new IOException("Intervalo inválido para retomar.");total=Long.parseLong(range.substring(range.indexOf('/')+1)); }else offset=0;
            job.put("state","downloading");long done=offset,last=System.currentTimeMillis(),previous=done;
            try(InputStream input=active.getInputStream();FileOutputStream output=new FileOutputStream(partial,offset>0)) { byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1) { if(cancelled(job))return;output.write(buffer,0,count);done+=count;long current=System.currentTimeMillis();if(current-last>=1000) { status(job,done,Math.max(0,total),(done-previous)*1000/(current-last),0);last=current;previous=done; } }output.getFD().sync(); }
            if(cancelled(job))return;if(total>0 && done!=total)throw new IOException("Download interrompido; toque em retomar.");Files.move(partial.toPath(),target.toPath());status(job,done,done,0,0);
        }finally { active.disconnect();connection=null; }
    }
    private void torrent(JSONObject job,JSONObject raw,File directory) throws Exception {
        job.put("state","metadata");publish(false);File scratch=new File(context.getExternalFilesDir(null),"torrent-cache/"+job.getString("id"));scratch.mkdirs();
        try(TorrentMedia torrent=new TorrentMedia(scratch,raw,() -> cancelled(job))) {
            String name=torrent.file.getName(),extension=name.substring(name.lastIndexOf('.')).toLowerCase(Locale.ROOT);File target=new File(directory,raw.getString("prefix")+extension);if(target.exists())throw new IOException("O arquivo de destino já existe.");job.put("fileName",target.getName()).put("state","downloading");
            while(!cancelled(job) && torrent.downloaded()<torrent.size) { org.libtorrent4j.TorrentStatus state=torrent.handle.status();status(job,torrent.downloaded(),torrent.size,state.downloadPayloadRate(),state.numPeers());Thread.sleep(1000); }
            if(cancelled(job))return;torrent.handle.pause();Files.copy(torrent.file.toPath(),target.toPath());status(job,torrent.size,torrent.size,0,0);
        }
    }
    static final class UriOpen {
        static void open(Context context,Activity activity,File file) { android.net.Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",file);String mime=URLConnection.guessContentTypeFromName(file.getName());if(mime==null)mime="application/octet-stream";final Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.runOnUiThread(() -> activity.startActivity(intent)); }
    }
}
