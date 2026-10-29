package io.cinessd.android;
import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.os.*;
import android.view.*;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.media3.common.*;
import androidx.media3.ui.*;
import org.json.*;
import java.io.File;
import java.util.concurrent.*;

public class PlayerActivity extends ComponentActivity {
    static PlayerActivity current;
    private PlayerView view;
    private TextView loading;
    private JSONObject source;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private boolean closing;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);current=this;getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.rgb(11,14,9));
        Button back=new Button(this);back.setText("‹  Voltar à biblioteca");back.setOnClickListener(button -> finish());layout.addView(back,new LinearLayout.LayoutParams(-1,-2));
        loading=new TextView(this);loading.setText("Preparando reprodução…");loading.setTextColor(Color.WHITE);loading.setGravity(Gravity.CENTER);loading.setPadding(20,20,20,20);layout.addView(loading,new LinearLayout.LayoutParams(-1,-2));
        view=new PlayerView(this);view.setShowSubtitleButton(true);view.setShowNextButton(false);view.setShowPreviousButton(false);view.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);view.setControllerAutoShow(true);layout.addView(view,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
        try { source=new JSONObject(getIntent().getStringExtra("source"));setTitle(source.optString("title","Umbra"));startService(new Intent(this,PlaybackService.class));awaitService(0); }catch(Exception error){fail(error.getMessage());}
    }
    private void awaitService(int attempt) {
        if(closing)return;if(PlaybackService.instance==null) { if(attempt>100){fail("O player não iniciou.");return;}ui.postDelayed(() -> awaitService(attempt+1),50);return; }
        PlaybackService playback=PlaybackService.instance;
        io.submit(() -> { try {
            if(playback.torrent!=null){playback.torrent.close();playback.torrent=null;}
            String url=source.optString("url");
            if(source.has("infoHash")) { File directory=new File(getExternalFilesDir(null),"torrent-stream/"+java.util.UUID.randomUUID());TorrentMedia torrent=new TorrentMedia(directory,source,() -> closing);if(closing){torrent.close();return;}playback.torrent=torrent;url=torrent.streamURL(); }
            final String target=url;ui.post(() -> { try { if(closing)return;view.setPlayer(playback.player);playback.load(source,target);loading.setText(source.optString("title","Umbra"));applyAppearance(source.optJSONObject("appearance"));if("audiobook".equals(source.optString("type")))view.setControllerShowTimeoutMs(0); }catch(Exception error){fail(error.getMessage());} });
        }catch(Exception error){ui.post(() -> fail(error.getMessage()));} });
    }
    private void applyAppearance(JSONObject appearance) {
        if(appearance==null || view.getSubtitleView()==null)return;
        int textColor=Color.parseColor(appearance.optString("color","#ffffff"));String background=appearance.optString("background","translucent");int fill="black".equals(background)?Color.BLACK:"translucent".equals(background)?0xaa000000:Color.TRANSPARENT;
        view.getSubtitleView().setStyle(new CaptionStyleCompat(textColor,fill,Color.TRANSPARENT,appearance.optBoolean("outline",true)?CaptionStyleCompat.EDGE_TYPE_OUTLINE:CaptionStyleCompat.EDGE_TYPE_NONE,Color.BLACK,null));view.getSubtitleView().setFixedTextSize(android.util.TypedValue.COMPLEX_UNIT_SP,appearance.optInt("fontSize",24));view.getSubtitleView().setBottomPaddingFraction(appearance.optInt("bottom",5)/100f);
    }
    void control(String action,Object value) { runOnUiThread(() -> { PlaybackService service=PlaybackService.instance;if(service==null)return;switch(action) { case "pause":service.player.setPlayWhenReady(!service.player.getPlayWhenReady());break;case "seek":service.player.seekTo((long)(((Number)value).doubleValue()*1000));break;case "speed":service.player.setPlaybackSpeed(((Number)value).floatValue());break;case "volume":service.player.setVolume(((Number)value).floatValue()/100);break;case "stop":finish();break; } }); }
    private void fail(String error) { loading.setText(error==null ? "Não foi possível abrir esta fonte." : error); }
    @Override public void finish() { closing=true;stopService(new Intent(this,PlaybackService.class));super.finish(); }
    @Override protected void onDestroy() { closing=true;ui.removeCallbacksAndMessages(null);view.setPlayer(null);io.shutdownNow();if(current==this)current=null;super.onDestroy(); }
}
