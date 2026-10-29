package io.cinessd.android;
import android.content.*;
import android.os.*;
import androidx.annotation.Nullable;
import androidx.media3.common.*;
import androidx.media3.datasource.*;
import androidx.media3.exoplayer.*;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.*;
import com.getcapacitor.JSObject;
import org.json.*;

public class PlaybackService extends MediaSessionService {
    static PlaybackService instance;
    ExoPlayer player;
    private MediaSession session;
    private final Handler clock=new Handler(Looper.getMainLooper());
    private JSONObject source;
    private double watched;
    private long previousPosition;
    private boolean reportedEnd;
    TorrentMedia torrent;
    @Override public void onCreate() {
        super.onCreate();instance=this;
        player=new ExoPlayer.Builder(this).build();player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);player.setWakeMode(C.WAKE_MODE_NETWORK);session=new MediaSession.Builder(this,player).build();
        player.addListener(new Player.Listener() { @Override public void onPlaybackStateChanged(int state) { if(state==Player.STATE_ENDED)report(true); } });
        clock.post(tick);
    }
    void load(JSONObject source,String url) throws Exception {
        this.source=source;watched=0;previousPosition=source.optLong("start",0)*1000;reportedEnd=false;
        DefaultHttpDataSource.Factory http=new DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(false).setDefaultRequestProperties(UmbraDevicePlugin.headers(source.optJSONObject("headers")==null?new JSONObject():source.getJSONObject("headers")));
        DefaultDataSource.Factory data=new DefaultDataSource.Factory(this,http);
        MediaItem item=new MediaItem.Builder().setUri(url).setMediaMetadata(new MediaMetadata.Builder().setTitle(source.optString("title","Umbra")).setMediaType("audiobook".equals(source.optString("type"))?MediaMetadata.MEDIA_TYPE_AUDIO_BOOK:MediaMetadata.MEDIA_TYPE_MOVIE).build()).build();
        player.setMediaSource(new DefaultMediaSourceFactory(data).createMediaSource(item));player.seekTo(previousPosition);player.prepare();player.play();
    }
    private final Runnable tick=new Runnable(){ @Override public void run() { report(false);clock.postDelayed(this,3000); } };
    private void report(boolean ended) {
        if(source==null || reportedEnd)return;long position=player.getCurrentPosition();double advance=(position-previousPosition)/1000.0;if(player.isPlaying() && advance>0 && advance<20)watched+=advance/player.getPlaybackParameters().speed;previousPosition=position;
        JSObject event=new JSObject().put("type","playback").put("fileId",source.optString("fileId","")).put("position",position/1000.0).put("duration",Math.max(0,player.getDuration()/1000.0)).put("watchedSeconds",watched).put("ended",ended);
        try { new PrivateDocuments(this).write("native-playback",event.toString()); }catch(Exception ignored){}
        if(UmbraDevicePlugin.instance!=null)UmbraDevicePlugin.instance.event(event);
        if(ended)reportedEnd=true;
    }
    @Override public MediaSession onGetSession(MediaSession.ControllerInfo info) { return session; }
    @Override public void onTaskRemoved(@Nullable Intent rootIntent) { if(!player.getPlayWhenReady() || player.getMediaItemCount()==0)stopSelf(); }
    @Override public void onDestroy() { report(true);clock.removeCallbacksAndMessages(null);if(torrent!=null)torrent.close();session.release();player.release();instance=null;super.onDestroy(); }
}
