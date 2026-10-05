import { createConnection,type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
export class MpvIPC extends EventEmitter {
  private socket?: Socket;
  private next = 0;
  private pending = new Map<number,{ resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  async connect(address: string,alive: () => boolean) {
    const end = Date.now()+10000;
    while (alive() && Date.now()<end) {
      const socket = createConnection(address);
      const connected = await new Promise<boolean>(resolve => { socket.once('connect',() => resolve(true)); socket.once('error',() => resolve(false)); });
      if (!connected) { socket.destroy(); await new Promise(resolve => setTimeout(resolve,40)); continue; }
      this.socket = socket; socket.setEncoding('utf8'); let input = '';
      socket.on('data',chunk => {
        input += chunk;
        if (input.length>4_000_000) { socket.destroy(new Error('Resposta mpv grande demais.')); return; }
        let end;
        while ((end=input.indexOf('\n'))>=0) {
          const line=input.slice(0,end); input=input.slice(end+1);
          try {
            const event=JSON.parse(line), task=this.pending.get(event.request_id);
            if (task) { clearTimeout(task.timer); this.pending.delete(event.request_id); event.error==='success' ? task.resolve(event.data) : task.reject(new Error(`mpv: ${event.error}`)); }
            else if (event.event) this.emit('event',event);
          } catch { socket.destroy(new Error('Resposta mpv inválida.')); }
        }
      });
      socket.on('error',() => {}); socket.on('close',() => { this.close(); this.emit('closed'); });
      return;
    }
    throw new Error('Não foi possível conectar ao motor mpv.');
  }
  command(...command: unknown[]): Promise<any> {
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('O motor mpv foi encerrado.'));
    const request_id=++this.next;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(() => { this.pending.delete(request_id); reject(new Error('O motor mpv não respondeu.')); },10000);
      this.pending.set(request_id,{ resolve,reject,timer });
      this.socket!.write(JSON.stringify({ command,request_id })+'\n',error => { if(error){clearTimeout(timer);this.pending.delete(request_id);reject(error);} });
    });
  }
  close() {
    const socket=this.socket; this.socket=undefined; socket?.destroy();
    for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error('O motor mpv foi encerrado.'));}
    this.pending.clear();
  }
}
