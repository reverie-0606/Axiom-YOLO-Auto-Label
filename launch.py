import argparse
import ctypes
import os
import socket
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7864)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    os.chdir(Path(__file__).resolve().parent)
    if os.name == "nt":
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Axiom.YOLO.AutoLabel")
    url = f"http://127.0.0.1:{args.port}"
    try:
        with urllib.request.urlopen(url + "/api/health", timeout=2) as r:
            if b'Axiom YOLO Auto Label' in r.read():
                if not args.no_browser:
                    webbrowser.open(url)
                return
    except Exception:
        pass
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", args.port))
    except OSError:
        sock.bind(("127.0.0.1", 0))
        args.port = sock.getsockname()[1]
        url = f"http://127.0.0.1:{args.port}"
    finally:
        sock.close()
    if not args.no_browser:
        def open_when_ready():
            for _ in range(120):
                try:
                    urllib.request.urlopen(url + "/api/health", timeout=1).close()
                    webbrowser.open(url)
                    return
                except Exception:
                    time.sleep(0.5)
        threading.Thread(target=open_when_ready, daemon=True).start()
    import uvicorn
    print(f"Axiom YOLO Auto Label · {url}", flush=True)
    uvicorn.run("axiom.app:app", host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
