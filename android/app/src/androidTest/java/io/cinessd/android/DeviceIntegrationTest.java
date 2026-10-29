package io.cinessd.android;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.libtorrent4j.SessionManager;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DeviceIntegrationTest {
    private Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
    @Test public void encryptedDocumentsSurviveReopenAndRejectTampering() throws Exception {
        Context context=context();String name="test-private-document";String value="{\"secret\":\"private-value-123\"}";
        new PrivateDocuments(context).write(name,value);
        assertEquals(value,new PrivateDocuments(context).read(name));
        File file=new File(new File(context.getFilesDir(),"private-documents"),name+".enc");
        // Check persisted bytes independently of the JSON document API.
        assertTrue(file.exists());byte[] bytes=Files.readAllBytes(file.toPath());assertFalse(new String(bytes,StandardCharsets.ISO_8859_1).contains("private-value-123"));
        bytes[bytes.length-1]^=1;Files.write(file.toPath(),bytes);
        try { new PrivateDocuments(context).read(name);fail("Modified ciphertext was accepted"); }catch(Exception expected) { }
        file.delete();
    }
    @Test public void nativeTorrentEngineStartsOnThisABI() {
        SessionManager session=new SessionManager();try { session.start();assertTrue(session.isRunning()); }finally { session.stop(); }
    }
    @Test public void updaterRejectsWrongHostAndInstalledVersionBeforeNetwork() throws Exception {
        Context context=context();String digest="a".repeat(64);
        try { AndroidUpdates.downloadAndVerify(context,"https://example.org/app.apk",digest,Integer.MAX_VALUE);fail(); }catch(java.io.IOException expected) { assertTrue(expected.getMessage().contains("Endereço")); }
        try { AndroidUpdates.downloadAndVerify(context,"https://github.com/AugustodoBRT/Umbra/releases/download/android-latest/Umbra-android.apk",digest,1);fail(); }catch(java.io.IOException expected) { assertTrue(expected.getMessage().contains("instalada")); }
    }
}
