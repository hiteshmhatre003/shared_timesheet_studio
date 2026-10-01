import frappe

# (role name, desk access). "Kiosk Device" has NO desk access on purpose: the
# tablet's account can run the kiosk page but can't open the ERPNext /app desk.
ROLES = [
    ("Kiosk Device", 0),
    ("Timesheet Manager", 1),  # already exists on your site (used by timesheet_kiosk) — skipped if so
]


def before_install():
    for role_name, desk_access in ROLES:
        if not frappe.db.exists("Role", role_name):
            frappe.get_doc(
                {"doctype": "Role", "role_name": role_name, "desk_access": desk_access}
            ).insert(ignore_permissions=True)
    frappe.db.commit()


def after_install():
    set_default_settings()


def set_default_settings():
    """Writes every Kiosk Settings default explicitly. (Frappe reads a
    never-saved tick-box as 0/off, so relying on the doctype's own defaults
    would leave e.g. face check and manual entries switched off.)"""
    defaults = {
        "worker_session_seconds": 60,
        "max_pin_attempts": 5,
        "lockout_minutes": 15,
        "require_photo": 0,
        "allow_manual_entries": 1,
        "one_timer_per_worker": 1,
        "face_enabled": 1,
        "face_strictness": "Normal",
        "require_blink": 1,
        "allow_pin_fallback": 1,
        "max_face_attempts": 5,
    }
    settings = frappe.get_single("Kiosk Settings")
    settings.update(defaults)
    settings.flags.ignore_permissions = True
    settings.save()
    frappe.db.commit()
