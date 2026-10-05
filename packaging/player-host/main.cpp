// Own only the native child surface. mpv handles decoding, GPU output and input.
// Protocol: stdin "bounds x y width height visible" / "quit"; stdout child handle.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <X11/Xlib.h>
#endif
struct Bounds { int x=0,y=0,w=1,h=1; bool visible=false,dirty=false; };
int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const auto parent = std::strtoull(argv[1],nullptr,10);
  if (!parent) return 2;
#ifdef _WIN32
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  WNDCLASSW klass{}; klass.lpfnWndProc=DefWindowProcW; klass.hInstance=GetModuleHandleW(nullptr);
  klass.lpszClassName=L"UmbraPlayerSurface"; klass.hbrBackground=(HBRUSH)GetStockObject(BLACK_BRUSH);
  if (!RegisterClassW(&klass)) return 3;
  HWND child=CreateWindowExW(0,klass.lpszClassName,L"",WS_CHILD|WS_CLIPCHILDREN|WS_CLIPSIBLINGS,0,0,1,1,(HWND)(uintptr_t)parent,nullptr,klass.hInstance,nullptr);
  if (!child) return 4;
  std::cout << (uintptr_t)child << std::endl;
#else
  Display* display=XOpenDisplay(nullptr); if (!display) return 3;
  Window child=XCreateSimpleWindow(display,(Window)parent,0,0,1,1,0,0,0);
  XSelectInput(display,child,StructureNotifyMask); XFlush(display);
  std::cout << child << std::endl;
#endif
  std::atomic<bool> done{false}; std::mutex mutex; Bounds bounds;
  // The reader never touches the platform UI. EOF closes the owned surface.
  std::thread reader([&]{
    std::string line;
    while(std::getline(std::cin,line)) {
      if(line=="quit") break;
      std::istringstream input(line); std::string action; int x,y,w,h,visible;
      if(input>>action>>x>>y>>w>>h>>visible && action=="bounds" && w>0 && h>0 && w<=32768 && h<=32768) {
        std::lock_guard<std::mutex> lock(mutex); bounds={x,y,w,h,visible!=0,true};
      }
    }
    done=true;
  });
  while(!done) {
    Bounds current; { std::lock_guard<std::mutex> lock(mutex); current=bounds; bounds.dirty=false; }
    if(current.dirty) {
#ifdef _WIN32
      SetWindowPos(child,HWND_TOP,current.x,current.y,current.w,current.h,SWP_NOACTIVATE|(current.visible?SWP_SHOWWINDOW:SWP_HIDEWINDOW));
#else
      XMoveResizeWindow(display,child,current.x,current.y,current.w,current.h);
      if(current.visible) XMapWindow(display,child); else XUnmapWindow(display,child);
      XFlush(display);
#endif
    }
#ifdef _WIN32
    MSG message; while(PeekMessageW(&message,nullptr,0,0,PM_REMOVE)){ TranslateMessage(&message); DispatchMessageW(&message); }
    if(!IsWindow((HWND)(uintptr_t)parent)) break;
#else
    while(XPending(display)) { XEvent event; XNextEvent(display,&event); if(event.type==DestroyNotify) done=true; }
#endif
    std::this_thread::sleep_for(std::chrono::milliseconds(16));
  }
#ifdef _WIN32
  DestroyWindow(child);
#else
  XDestroyWindow(display,child); XCloseDisplay(display);
#endif
  // Parent exits can leave the pipe open; process exit terminates the reader.
  reader.detach(); std::exit(0);
}
