package io.cinessd.android;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) { registerPlugin(UmbraDevicePlugin.class); super.onCreate(state); }
}
