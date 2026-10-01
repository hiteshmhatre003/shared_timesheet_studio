import os

import frappe
from frappe.utils import now_datetime

no_cache = 1


def _asset_version():
    """Changes only when this app's own files change (i.e. on deploy), so
    browsers never keep stale JS/CSS but can still cache between deploys."""
    app_path = frappe.get_app_path("shared_timesheet")
    candidates = [
        os.path.join(app_path, "public", "js", "shared-kiosk-app.js"),
        os.path.join(app_path, "public", "js", "shared-kiosk-api.js"),
        os.path.join(app_path, "public", "css", "shared-kiosk.css"),
        os.path.join(app_path, "www", "kiosk.html"),
    ]
    mtimes = [os.path.getmtime(p) for p in candidates if os.path.exists(p)]
    if not mtimes:
        return now_datetime().strftime("%Y%m%d%H%M%S")
    return str(int(max(mtimes)))


def get_context(context):
    context.csrf_token = frappe.sessions.get_csrf_token()
    context.asset_version = _asset_version()
    return context
