package io.cinessd.android;

import android.app.Activity;
import android.content.*;
import android.content.pm.*;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

@CapacitorPlugin(name="UmbraDevice",permissions={ @Permission(alias="notifications",strings={"android.permission.POST_NOTIFICATIONS"}) })
public class UmbraDevicePlugin extends Plugin {
    static UmbraDevicePlugin instance;
    private final ExecutorService io = Executors.newFixedThreadPool(4);
    private PrivateDocuments documents;
    private File pendingUpdate;
    @Override public void load() { instance = this; documents = new PrivateDocuments(getContext()); Transfers.get(getContext()).setEvents(this::event); }
    void event(JSObject value) { notifyListeners("deviceEvent",value,true); }
    private interface Task { JSObject run() throws Exception; }
    private void work(PluginCall call,Task task) { io.execute(() -> { try { call.resolve(task.run()); } catch(Exception error) { call.reject(error.getMessage()==null ? "Não foi possível concluir a operação." : error.getMessage()); } }); }
    @PluginMethod public void readDocument(PluginCall call) { work(call,() -> { String value=documents.read(call.getString("name")); return new JSObject().put("value",value==null?JSONObject.NULL:value); }); }
    @PluginMethod public void writeDocument(PluginCall call) { work(call,() -> { documents.write(call.getString("name"),call.getString("value")); return new JSObject(); }); }
    @PluginMethod public void http(PluginCall call) { work(call,() -> {
        Map<String,String> headers = headers(call.getObject("headers",new JSObject())); HttpURLConnection connection = Network.connect(call.getString("url"),headers);
        try { int status = connection.getResponseCode(); InputStream input = status>=400 ? connection.getErrorStream() : connection.getInputStream(); String body = input==null ? "" : new String(Network.read(input,Math.min(5_000_000,call.getInt("limit",5_000_000))),StandardCharsets.UTF_8);
            return new JSObject().put("body",body).put("status",status).put("url",connection.getURL().toString());
        } finally { connection.disconnect(); }
    }); }
    static Map<String,String> headers(JSONObject data) throws JSONException { Map<String,String> result = new HashMap<>(); for(Iterator<String> keys=data.keys();keys.hasNext();) { String key=keys.next(); result.put(key,data.getString(key)); } return result; }
    @PluginMethod public void chooseFolder(PluginCall call) { Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION); startActivityForResult(call,intent,"folderChosen"); }
    @ActivityCallback private void folderChosen(PluginCall call,ActivityResult result) {
        if(call==null)return; if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null) { call.resolve(new JSObject().put("cancelled",true)); return; }
        Uri uri=result.getData().getData(); int flags=result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { getContext().getContentResolver().takePersistableUriPermission(uri,flags); DocumentFile folder=DocumentFile.fromTreeUri(getContext(),uri); call.resolve(new JSObject().put("uri",uri.toString()).put("name",folder!=null ? folder.getName() : "Biblioteca")); } catch(Exception error) { call.reject("Não foi possível autorizar esta pasta."); }
    }
    DocumentFile document(String value) throws Exception {
        Uri uri=Uri.parse(value);
        if("file".equals(uri.getScheme())) { File file=new File(uri.getPath()).getCanonicalFile(); File root=getContext().getExternalFilesDir(null).getCanonicalFile(); if(!file.toPath().startsWith(root.toPath()) && !file.toPath().startsWith(getContext().getFilesDir().getCanonicalFile().toPath())) throw new IOException("Pasta fora do armazenamento autorizado."); return DocumentFile.fromFile(file); }
        if(!"content".equals(uri.getScheme()))throw new IOException("Arquivo não autorizado.");
        DocumentFile file=DocumentFile.fromTreeUri(getContext(),uri); if(file==null)throw new IOException("Pasta indisponível."); return file;
    }
    @PluginMethod public void exists(PluginCall call) { work(call,() -> new JSObject().put("exists",document(call.getString("uri")).exists())); }
    @PluginMethod public void scan(PluginCall call) { work(call,() -> { JSArray files=new JSArray(),errors=new JSArray(); scan(document(call.getString("uri")),"",files,errors,0); return new JSObject().put("files",files).put("errors",errors); }); }
    private void scan(DocumentFile folder,String prefix,JSArray files,JSArray errors,int depth) {
        if(!folder.exists() || !folder.canRead()) { errors.put("Pasta indisponível: "+prefix); return; }
        if(depth>30 || files.length()>20000) { errors.put("A pasta excedeu o limite de importação."); return; }
        for(DocumentFile file:folder.listFiles()) {
            String name=file.getName(); if(name==null || name.startsWith(".") || name.matches("(?i)^(Biblioteca|Apps|sample|samples|extras?|trailers?)$"))continue;
            String path=prefix+name;
            if(file.isDirectory()) { scan(file,path+"/",files,errors,depth+1); continue; }
            if(!name.matches("(?i).*\\.(mkv|mp4|avi|mov|m4v|webm|mpg|mpeg|ts|m2ts|wmv)$"))continue;
            long duration=0;int width=0,height=0;
            MediaMetadataRetriever reader=new MediaMetadataRetriever();try { reader.setDataSource(getContext(),file.getUri()); duration=Long.parseLong(Optional.ofNullable(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)).orElse("0"))/1000; width=Integer.parseInt(Optional.ofNullable(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)).orElse("0")); height=Integer.parseInt(Optional.ofNullable(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)).orElse("0")); } catch(Exception ignored) { } finally { try { reader.release(); }catch(Exception ignored){} }
            files.put(new JSObject().put("id",file.getUri().toString()).put("name",name).put("path",path).put("size",file.length()).put("duration",duration).put("width",width).put("height",height));
        }
    }
    @PluginMethod public void deleteFiles(PluginCall call) { work(call,() -> { JSArray uris=call.getArray("uris"); for(int i=0;i<uris.length();i++) { Uri uri=Uri.parse(uris.getString(i)); DocumentFile file="file".equals(uri.getScheme()) ? document(uri.toString()) : DocumentFile.fromSingleUri(getContext(),uri); if(file==null || !file.exists() || !file.delete())throw new IOException("Não foi possível excluir um arquivo. Os demais dados foram preservados."); } return new JSObject(); }); }
    @PluginMethod public void open(PluginCall call) {
        try { Uri uri=Uri.parse(call.getString("url")); Intent intent;
            if("http".equals(uri.getScheme()) || "https".equals(uri.getScheme())) { Network.url(uri.toString()); intent=new Intent(Intent.ACTION_VIEW,uri); }
            else { if("file".equals(uri.getScheme())) { document(uri.toString()); uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",new File(uri.getPath())); } if(!"content".equals(uri.getScheme()))throw new IOException("Arquivo inválido."); intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,getContext().getContentResolver().getType(uri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            getActivity().startActivity(intent); call.resolve();
        } catch(Exception error) { call.reject("Não há aplicativo disponível para abrir este acesso."); }
    }
    @PluginMethod public void exportFile(PluginCall call) { work(call,() -> {
        String name=call.getString("name","umbra.json").replaceAll("[^a-zA-Z0-9._-]","_"); String root=call.getString("uri"); Uri uri;
        if(root!=null) { DocumentFile target=document(root).createFile("application/json",name); if(target==null)throw new IOException("Não foi possível criar o backup."); uri=target.getUri(); try(OutputStream output="file".equals(uri.getScheme())?new FileOutputStream(new File(uri.getPath())):getContext().getContentResolver().openOutputStream(uri)) { output.write(call.getString("value").getBytes(StandardCharsets.UTF_8)); } }
        else { File dir=new File(getContext().getFilesDir(),"exports");dir.mkdirs(); File file=new File(dir,name); try(FileOutputStream output=new FileOutputStream(file)) { output.write(call.getString("value").getBytes(StandardCharsets.UTF_8)); } uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",file); getActivity().runOnUiThread(() -> getActivity().startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),"Exportar dados do Umbra"))); }
        return new JSObject().put("path",uri.toString());
    }); }
    @PluginMethod public void setDownloadFolder(PluginCall call) { work(call,() -> { Transfers.get(getContext()).destination(call.getString("uri"));return new JSObject(); }); }
    @PluginMethod public void enqueue(PluginCall call) { if(Build.VERSION.SDK_INT>=33 && getPermissionState("notifications")==PermissionState.PROMPT)requestPermissionForAlias("notifications",call,"enqueuePermitted");else enqueuePermitted(call); }
    @PermissionCallback private void enqueuePermitted(PluginCall call) { work(call,() -> { Transfers.get(getContext()).enqueue(call.getArray("jobs")); return new JSObject(); }); }
    @PluginMethod public void downloads(PluginCall call) { work(call,() -> Transfers.get(getContext()).snapshot()); }
    @PluginMethod public void downloadControl(PluginCall call) { work(call,() -> { Transfers.get(getContext()).control(call.getString("action"),call.getString("id"),getActivity()); return new JSObject(); }); }
    @PluginMethod public void play(PluginCall call) {
        try { Intent intent=new Intent(getContext(),PlayerActivity.class).putExtra("source",call.getData().toString()); getActivity().startActivity(intent); call.resolve(); } catch(Exception error) { call.reject("Não foi possível iniciar o player."); }
    }
    @PluginMethod public void control(PluginCall call) { if(PlayerActivity.current!=null) { PlayerActivity.current.control(call.getString("action"),call.getData().opt("value")); call.resolve(); } else call.reject("Abra um arquivo primeiro."); }
    @PluginMethod public void appInfo(PluginCall call) { work(call,() -> { PackageInfo info=getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),0); return new JSObject().put("versionCode",Build.VERSION.SDK_INT>=28 ? info.getLongVersionCode() : info.versionCode).put("versionName",info.versionName); }); }
    @PluginMethod public void installUpdate(PluginCall call) { io.execute(() -> {
        try { pendingUpdate=AndroidUpdates.downloadAndVerify(getContext(),call.getString("url"),call.getString("sha256"),call.getInt("versionCode",0));
            getActivity().runOnUiThread(() -> { if(Build.VERSION.SDK_INT>=26 && !getContext().getPackageManager().canRequestPackageInstalls()) startActivityForResult(call,new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getContext().getPackageName())),"installPermission"); else install(call); });
        } catch(Exception error) { call.reject(error.getMessage()); }
    }); }
    @ActivityCallback private void installPermission(PluginCall call,ActivityResult result) { if(call==null)return; if(Build.VERSION.SDK_INT>=26 && !getContext().getPackageManager().canRequestPackageInstalls()) { call.reject("Autorize o Umbra a instalar atualizações e toque em atualizar novamente."); return; } install(call); }
    private void install(PluginCall call) { try { Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",pendingUpdate); getActivity().startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)); call.resolve(); } catch(Exception error) { call.reject("Não foi possível abrir o instalador Android."); } }
}
