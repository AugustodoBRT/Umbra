package io.cinessd.android;
import java.net.*;
import java.io.*;
import java.util.*;
final class Network {
    static URL url(String value) throws Exception {
        URI uri = new URI(value); if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getUserInfo()!=null) throw new IOException("Endereço HTTP(S) inválido."); return uri.toURL();
    }
    static HttpURLConnection connect(String value,Map<String,String> headers) throws Exception {
        URL target = url(value);
        for(int i=0;i<6;i++) {
            HttpURLConnection connection = (HttpURLConnection)target.openConnection(); connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(25000);
            for(Map.Entry<String,String> entry:headers.entrySet()) if(!entry.getKey().matches(".*[\\r\\n].*") && !entry.getValue().matches(".*[\\r\\n].*")) connection.setRequestProperty(entry.getKey(),entry.getValue());
            int status = connection.getResponseCode();
            if(status>=300 && status<=399 && connection.getHeaderField("Location")!=null) {
                URL next = url(new URL(target,connection.getHeaderField("Location")).toString());
                if("https".equals(target.getProtocol()) && !"https".equals(next.getProtocol())) { connection.disconnect(); throw new IOException("Redirecionamento inseguro."); }
                if(!target.getHost().equals(next.getHost())) { headers = new HashMap<>(headers); headers.keySet().removeIf(key -> key.equalsIgnoreCase("Authorization") || key.equalsIgnoreCase("Cookie")); }
                connection.disconnect(); target = next; continue;
            }
            return connection;
        }
        throw new IOException("Redirecionamentos demais.");
    }
    static byte[] read(InputStream input,int limit) throws Exception {
        try(input; ByteArrayOutputStream output = new ByteArrayOutputStream()) { byte[] buffer = new byte[32768]; int count;
            while((count=input.read(buffer))!=-1) { if(output.size()+count>limit) throw new IOException("Resposta acima do limite permitido."); output.write(buffer,0,count); } return output.toByteArray(); }
    }
}
