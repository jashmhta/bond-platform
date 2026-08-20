import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app


class _StripHandlerPrefix:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        pi = environ.get("PATH_INFO", "")
        if pi in ("/api/index", "/api/index/"):
            environ["PATH_INFO"] = "/"
        elif pi.startswith("/api/index/"):
            environ["PATH_INFO"] = pi[len("/api/index"):] or "/"
        return self.wsgi_app(environ, start_response)


app = _StripHandlerPrefix(app)
