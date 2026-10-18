// Own only the native child surface. mpv handles decoding, GPU output and input.
// Protocol: stdin "bounds x y width height visible [count x y w h ...]" / "quit"; stdout child handle.
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
#include <vector>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#else
#include <X11/Xlib.h>
#include <X11/extensions/shape.h>
#endif
struct Rectangle { int x,y,w,h; };
struct Bounds { int x=0,y=0,w=1,h=1; bool visible=false,dirty=false; std::vector<Rectangle> overlays; };
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
  int shapeEvent,shapeError;
  if(!XShapeQueryExtension(display,&shapeEvent,&shapeError)) { XCloseDisplay(display); return 3; }
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
        Bounds next{x,y,w,h,visible!=0,true};
        int count=0;
        if(input>>count) {
          if(count<0 || count>8) continue;
          bool valid=true;
          for(int i=0;i<count;i++) {
            Rectangle overlay;
            if(!(input>>overlay.x>>overlay.y>>overlay.w>>overlay.h) || overlay.x<0 || overlay.y<0 || overlay.w<=0 || overlay.h<=0 || overlay.x>w || overlay.y>h || overlay.w>w-overlay.x+2 || overlay.h>h-overlay.y+2) { valid=false; break; }
            next.overlays.push_back(overlay);
          }
          if(!valid) continue;
        }
        std::lock_guard<std::mutex> lock(mutex); bounds=next;
      }
    }
    done=true;
  });
  while(!done) {
    Bounds current; { std::lock_guard<std::mutex> lock(mutex); current=bounds; bounds.dirty=false; }
    if(current.dirty) {
#ifdef _WIN32
      if(!current.overlays.empty()) {
        HRGN region=CreateRectRgn(0,0,current.w,current.h);
        for(const auto& rect:current.overlays) {
          HRGN overlay=CreateRectRgn(rect.x,rect.y,rect.x+rect.w,rect.y+rect.h);
          CombineRgn(region,region,overlay,RGN_DIFF); DeleteObject(overlay);
        }
        if(!SetWindowRgn(child,region,TRUE)) DeleteObject(region);
      } else SetWindowRgn(child,nullptr,TRUE);
      SetWindowPos(child,HWND_TOP,current.x,current.y,current.w,current.h,SWP_NOACTIVATE|(current.visible?SWP_SHOWWINDOW:SWP_HIDEWINDOW));
#else
      XMoveResizeWindow(display,child,current.x,current.y,current.w,current.h);
      // A bounding shape clips mpv's descendants and passes panel input through.
      // The window geometry stays full size, preserving video scale and center.
      XShapeCombineMask(display,child,ShapeBounding,0,0,None,ShapeSet);
      for(const auto& rect:current.overlays) {
        XRectangle overlay{(short)rect.x,(short)rect.y,(unsigned short)rect.w,(unsigned short)rect.h};
        XShapeCombineRectangles(display,child,ShapeBounding,0,0,&overlay,1,ShapeSubtract,Unsorted);
      }
      // Chromium can restack its rendering child when fullscreen changes. Keep
      // the video above that child, as SetWindowPos(HWND_TOP) does on Windows.
      if(current.visible) XMapRaised(display,child); else XUnmapWindow(display,child);
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
