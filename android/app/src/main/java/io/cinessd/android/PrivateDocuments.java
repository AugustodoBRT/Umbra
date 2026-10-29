package io.cinessd.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PrivateDocuments {
    private final File directory;
    PrivateDocuments(Context context) { directory = new File(context.getFilesDir(),"private-documents"); directory.mkdirs(); }
    private static synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("umbra-documents")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("umbra-documents",KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generator.generateKey();
        }
        return (SecretKey)store.getKey("umbra-documents",null);
    }
    private File file(String name) { if (!name.matches("[a-z0-9-]{1,100}")) throw new IllegalArgumentException("Nome inválido."); return new File(directory,name+".enc"); }
    synchronized String read(String name) throws Exception {
        File file = file(name); if (!file.exists()) return null;
        byte[] bytes = new AtomicFile(file).readFully(); if (bytes.length < 29) throw new IOException("Dados privados inválidos; os arquivos foram preservados.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,bytes,0,12)); cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        return new String(cipher.doFinal(bytes,12,bytes.length-12),StandardCharsets.UTF_8);
    }
    synchronized void write(String name,String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key()); cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        byte[] encoded = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)); AtomicFile file = new AtomicFile(file(name)); FileOutputStream output = file.startWrite();
        try { output.write(cipher.getIV()); output.write(encoded); file.finishWrite(output); } catch(Exception error) { file.failWrite(output); throw error; }
    }
}
