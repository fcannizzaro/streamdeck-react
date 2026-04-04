import { NativeWindow } from "@nativewindow/webview";

const win = new NativeWindow({
  title: "My App",
  width: 1024,
  height: 768,
  devtools: true,
});

console.log(win);

win.loadHtml("<h1>Hello</h1>");
