#!/usr/bin/env python3
"""Local preview server that never lets the browser cache: models, scripts and data are re-read on every reload.

    python3 tools/serve.py          # http://127.0.0.1:8000/
    python3 tools/serve.py 8765

`python3 -m http.server` sends no cache headers, so browsers keep stale copies of rebuilt models/*.glb and edited src/.
"""
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"serving {os.getcwd()} at http://127.0.0.1:{port}/ (no caching)")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
