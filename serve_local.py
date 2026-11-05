#!/usr/bin/env python3
"""Serve the PMV and proxy the production search index with byte ranges.

The viewer is static, but sql.js-httpvfs needs a same-origin endpoint because
the production beta host does not currently advertise CORS. This development
server leaves the 3.2 GB database remote and forwards only the byte ranges the
browser asks for.
"""

from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


REMOTE_INDEX = "https://beta.perseus.tufts.edu/search-index/"
FORWARDED_REQUEST_HEADERS = ("Range", "If-Range", "If-None-Match", "If-Modified-Since")
FORWARDED_RESPONSE_HEADERS = (
    "Accept-Ranges",
    "Cache-Control",
    "Content-Length",
    "Content-Range",
    "Content-Type",
    "ETag",
    "Last-Modified",
)


class ViewerHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Access-Control-Allow-Headers", "Range, If-Range, If-None-Match, If-Modified-Since")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.end_headers()

    def do_HEAD(self):
        if self._is_search_index_request():
            self._proxy_index(write_body=False)
        else:
            super().do_HEAD()

    def do_GET(self):
        if self._is_search_index_request():
            self._proxy_index(write_body=True)
        else:
            super().do_GET()

    def _is_search_index_request(self):
        return urlsplit(self.path).path.startswith("/search-index/")

    def _proxy_index(self, write_body):
        path = urlsplit(self.path).path
        relative = path[len("/search-index/"):]
        upstream = REMOTE_INDEX + relative
        headers = {
            name: self.headers[name]
            for name in FORWARDED_REQUEST_HEADERS
            if self.headers.get(name)
        }
        request = Request(upstream, headers=headers, method="GET" if write_body else "HEAD")
        try:
            response = urlopen(request, timeout=60)
        except HTTPError as error:
            response = error

        with response:
            self.send_response(response.status)
            self._send_cors_headers()
            for name in FORWARDED_RESPONSE_HEADERS:
                value = response.headers.get(name)
                if value is not None:
                    self.send_header(name, value)
            self.end_headers()
            if not write_body:
                return
            while True:
                block = response.read(64 * 1024)
                if not block:
                    break
                self.wfile.write(block)

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag")


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = partial(ViewerHandler, directory=root)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f"Perseus Multitext Viewer: http://localhost:{args.port}/")
    print(f"Search index proxy:       http://localhost:{args.port}/search-index/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
