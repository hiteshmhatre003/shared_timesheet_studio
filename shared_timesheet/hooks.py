app_name = "shared_timesheet"
app_title = "Shared Timesheet Kiosk"
app_publisher = "Amal Embroideries Private Limited"
app_description = "Shared-device (kiosk) timesheet: many workers, one tablet, each punch protected by the worker's own PIN + photo."
app_email = "admin@example.com"
app_license = "MIT"

# Creates the "Kiosk Device" (and, if missing, "Timesheet Manager") roles
# BEFORE this app's doctypes are synced, because those doctypes' permission
# rows refer to these roles. after_install fills in default Kiosk Settings.
before_install = "shared_timesheet.install.before_install"
after_install = "shared_timesheet.install.after_install"

# Served at /kiosk — deliberately a DIFFERENT address from the existing
# timesheet_kiosk app (/timesheet), so both apps can live on the same site
# without touching each other. The wildcard rule lets a hard refresh on a
# sub-path (e.g. /kiosk/w/timer/ET-0001) still load the app shell.
website_route_rules = [
    {"from_route": "/kiosk", "to_route": "kiosk"},
    {"from_route": "/kiosk/<path:app_path>", "to_route": "kiosk"},
]
