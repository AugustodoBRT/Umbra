package io.cinessd.android;

import org.json.*;
import org.libtorrent4j.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

final class TorrentMedia implements AutoCloseable {
    final SessionManager session = new SessionManager();
    final File directory;
    TorrentInfo info;
    TorrentHandle handle;
    int index;
    File file;
    long size;
    private ServerSocket server;
    private final ExecutorService sockets = Executors.newCachedThreadPool();
    private volatile boolean closed;
    TorrentMedia(File root,JSONObject source,BooleanSupplier cancelled) throws Exception {
        directory = root; directory.mkdirs(); String hash=source.getString("infoHash"); if(!hash.matches("(?i)[a-f0-9]{40}"))throw new IOException("Torrent inválido.");
        StringBuilder magnet=new StringBuilder("magnet:?xt=urn:btih:"+hash); JSONArray sources=source.optJSONArray("sources");
        if(sources!=null) for(int i=0;i<sources.length();i++) { String entry=sources.optString(i); if(entry.startsWith("tracker:"))magnet.append("&tr=").append(URLEncoder.encode(entry.substring(8),"UTF-8")); if(entry.startsWith("peer:"))magnet.append("&x.pe=").append(URLEncoder.encode(entry.substring(5),"UTF-8")); }
        try { session.start(); byte[] metadata=session.fetchMagnet(magnet.toString(),90,directory); if(metadata==null)throw new IOException("Não foi possível obter os metadados do torrent. Tente outra fonte."); if(cancelled.getAsBoolean())throw new InterruptedException();
        info=new TorrentInfo(metadata); if(info.numFiles()>10000)throw new IOException("Torrent com arquivos demais.");
        String type=source.optString("type","movie"),extensions="book".equals(type) ? "epub|pdf|mobi|azw3|fb2|cbz|cbr|txt" : "audiobook".equals(type) ? "mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav" : "mkv|mp4|avi|webm|m4v|mov|ts|m2ts";
        List<Integer> eligible=new ArrayList<>();
        for(int i=0;i<info.numFiles();i++) {
            File target=new File(directory,info.files().filePath(i)).getCanonicalFile(); if(!target.toPath().startsWith(directory.getCanonicalFile().toPath()) || info.files().fileFlags(i).and_(FileStorage.FLAG_SYMLINK).non_zero())throw new IOException("Caminho não permitido no torrent.");
            if(info.files().filePath(i).matches("(?i).*\\.("+extensions+")$"))eligible.add(i);
        }
        if(eligible.isEmpty())throw new IOException("O torrent não contém um arquivo compatível.");
        if(source.has("fileIdx") && !source.isNull("fileIdx")) { index=source.getInt("fileIdx"); if(!eligible.contains(index))throw new IOException("Arquivo indicado pela fonte não é compatível."); }
        else if(source.has("episode") && eligible.size()>1) { int season=source.optInt("season"),episode=source.getInt("episode"); List<Integer> matches=new ArrayList<>(); for(int i:eligible) if(info.files().filePath(i).matches("(?i).*(?:S0*"+season+"E0*"+episode+"(?![0-9])|0*"+season+"x0*"+episode+"(?![0-9])).*"))matches.add(i); if(matches.size()!=1)throw new IOException("Escolha uma fonte que identifique o episódio exato."); index=matches.get(0); }
        else index=eligible.stream().max(Comparator.comparingLong(i -> info.files().fileSize(i))).get();
        Priority[] priorities=Priority.array(Priority.IGNORE,info.numFiles()); priorities[index]=Priority.TOP_PRIORITY;
        session.download(info,directory,null,priorities,null,TorrentFlags.SEQUENTIAL_DOWNLOAD);
        long deadline=System.currentTimeMillis()+15000;
        while((handle=session.find(info.infoHash()))==null) { if(cancelled.getAsBoolean() || System.currentTimeMillis()>deadline)throw new IOException("O torrent não iniciou."); Thread.sleep(100); }
        file=new File(directory,info.files().filePath(index)); size=info.files().fileSize(index);
        } catch(Exception error) { close();throw error; }
    }
    long downloaded() { long[] progress=handle.fileProgress(); return index<progress.length ? progress[index] : 0; }
    String streamURL() throws Exception {
        server=new ServerSocket(); server.bind(new InetSocketAddress("127.0.0.1",0)); String token=UUID.randomUUID().toString();
        sockets.submit(() -> { while(!closed) { try { Socket socket=server.accept(); sockets.submit(() -> serve(socket,token)); } catch(IOException error) { break; } } });
        return "http://127.0.0.1:"+server.getLocalPort()+"/"+token;
    }
    private void serve(Socket socket,String token) {
        try(socket; BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII)); OutputStream output=socket.getOutputStream()) {
            socket.setSoTimeout(15000); String request=reader.readLine(); if(request==null)return; String[] parts=request.split(" "); if(parts.length<2 || !parts[1].equals("/"+token))return;
            long start=0,end=size-1; boolean range=false; String line;
            while((line=reader.readLine())!=null && !line.isEmpty()) if(line.toLowerCase(Locale.ROOT).startsWith("range: bytes=")) { String[] values=line.substring(13).trim().split("-",-1); range=true; if(values[0].isEmpty())start=Math.max(0,size-Long.parseLong(values[1])); else { start=Long.parseLong(values[0]); if(values.length>1 && !values[1].isEmpty())end=Math.min(end,Long.parseLong(values[1])); } }
            if(start<0 || start>=size || end<start) { output.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */"+size+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); return; }
            String headers="HTTP/1.1 "+(range?"206 Partial Content":"200 OK")+"\r\nAccept-Ranges: bytes\r\nContent-Type: application/octet-stream\r\nContent-Length: "+(end-start+1)+"\r\nConnection: close\r\n"+(range?"Content-Range: bytes "+start+"-"+end+"/"+size+"\r\n":"")+"\r\n";
            output.write(headers.getBytes(StandardCharsets.US_ASCII)); output.flush(); if("HEAD".equals(parts[0]))return;
            long offset=start,base=info.files().fileOffset(index),deadline=System.currentTimeMillis()+120000; byte[] buffer=new byte[32768];
            while(offset<=end && !closed) {
                int piece=(int)((base+offset)/info.pieceLength()); handle.setPieceDeadline(piece,0);
                while(!handle.havePiece(piece)) { if(closed || System.currentTimeMillis()>deadline)return; Thread.sleep(100); }
                while(!file.exists()) { if(closed)return; Thread.sleep(50); }
                long pieceEnd=(long)(piece+1)*info.pieceLength()-base;
                int count=(int)Math.min(buffer.length,Math.min(end-offset+1,pieceEnd-offset));
                try(RandomAccessFile input=new RandomAccessFile(file,"r")) { input.seek(offset); input.readFully(buffer,0,count); }
                output.write(buffer,0,count); offset+=count; deadline=System.currentTimeMillis()+120000;
            }
        } catch(Exception ignored) { }
    }
    @Override public void close() { closed=true; try { if(server!=null)server.close(); }catch(Exception ignored){} sockets.shutdownNow(); session.stop(); }
}
