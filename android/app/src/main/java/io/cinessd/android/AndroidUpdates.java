package io.cinessd.android;
import android.content.Context;
import android.content.pm.*;
import android.os.Build;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;

final class AndroidUpdates {
    static File downloadAndVerify(Context context,String url,String expected,int version) throws Exception {
        URI address=new URI(url);if(!"https".equals(address.getScheme()) || !"github.com".equals(address.getHost()) || !address.getPath().equals("/AugustodoBRT/Umbra/releases/download/android-latest/Umbra-android.apk") || address.getRawQuery()!=null || address.getUserInfo()!=null)throw new IOException("Endereço de atualização inválido.");
        if(expected==null || !expected.matches("[a-f0-9]{64}"))throw new IOException("Hash de atualização inválido.");
        PackageManager manager=context.getPackageManager();PackageInfo installed=manager.getPackageInfo(context.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        long current=Build.VERSION.SDK_INT>=28?installed.getLongVersionCode():installed.versionCode;if(version<=current)throw new IOException("Esta versão já está instalada.");
        File dir=new File(context.getCacheDir(),"updates");dir.mkdirs();File partial=new File(dir,"Umbra.apk.partial"),apk=new File(dir,"Umbra.apk");MessageDigest digest=MessageDigest.getInstance("SHA-256");
        HttpURLConnection connection=Network.connect(url,new HashMap<>());
        try { if(connection.getResponseCode()!=200)throw new IOException("Não foi possível baixar a atualização.");long size=0;try(InputStream input=connection.getInputStream();FileOutputStream output=new FileOutputStream(partial)) { byte[] buffer=new byte[65536];int count;while((count=input.read(buffer))!=-1) { size+=count;if(size>400_000_000)throw new IOException("APK acima do limite permitido.");output.write(buffer,0,count);digest.update(buffer,0,count);if(UmbraDevicePlugin.instance!=null)UmbraDevicePlugin.instance.event(new com.getcapacitor.JSObject().put("type","updateProgress").put("downloaded",size).put("total",connection.getContentLengthLong())); }output.getFD().sync(); } }
        finally { connection.disconnect(); }
        if(!hex(digest.digest()).equals(expected)){partial.delete();throw new IOException("A atualização não passou na verificação. Tente baixar novamente.");}
        PackageInfo incoming=manager.getPackageArchiveInfo(partial.getPath(),PackageManager.GET_SIGNING_CERTIFICATES);if(incoming==null || !installed.packageName.equals(incoming.packageName) || (Build.VERSION.SDK_INT>=28?incoming.getLongVersionCode():incoming.versionCode)!=version)throw new IOException("O APK não corresponde ao aplicativo e à versão anunciada.");
        if(!certificates(installed).equals(certificates(incoming)))throw new IOException("A assinatura da atualização não corresponde à instalação atual.");
        if(apk.exists() && !apk.delete())throw new IOException("Não foi possível substituir a atualização anterior.");if(!partial.renameTo(apk))throw new IOException("Não foi possível preparar o instalador.");return apk;
    }
    private static Set<String> certificates(PackageInfo info) throws Exception { Set<String> result=new HashSet<>();android.content.pm.Signature[] values=Build.VERSION.SDK_INT>=28?info.signingInfo.getApkContentsSigners():info.signatures;for(android.content.pm.Signature signature:values)result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));return result; }
    private static String hex(byte[] bytes) { StringBuilder value=new StringBuilder();for(byte b:bytes)value.append(String.format("%02x",b));return value.toString(); }
}
