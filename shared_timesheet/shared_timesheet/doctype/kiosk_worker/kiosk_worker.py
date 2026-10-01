# Copyright (c) 2026, Amal Embroideries Private Limited
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import now_datetime
from frappe.utils.password import update_password

from shared_timesheet.utils import PIN_FIELD, validate_pin_format


class KioskWorker(Document):
    def validate(self):
        if self.user and not frappe.db.get_value("User", self.user, "enabled"):
            frappe.throw(f"User {self.user} is disabled in ERPNext.")

        # The "Set / Reset PIN" box is only ever a one-time input: whatever is
        # typed is hashed into __Auth (see on_update) and the box is emptied,
        # so the PIN itself is never saved anywhere readable.
        typed = (self.get("new_pin") or "").strip()
        self.new_pin = None
        if typed and set(typed) != {"*"}:
            self.flags.pin_to_set = validate_pin_format(typed)
            self.has_pin = 1
            self.pin_last_changed = now_datetime()

    def on_update(self):
        pin = self.flags.get("pin_to_set")
        if pin:
            update_password(self.name, pin, doctype=self.doctype, fieldname=PIN_FIELD)
            self.flags.pin_to_set = None
            # A supervisor resetting the PIN also lifts any wrong-PIN lock.
            frappe.cache().delete_value(f"shared_timesheet:pin_fail:{self.name}")
            frappe.msgprint("PIN saved.", indicator="green", alert=True)

    def on_trash(self):
        frappe.db.delete("__Auth", {"doctype": self.doctype, "name": self.name, "fieldname": PIN_FIELD})
        # A worker's face data must not outlive the worker record.
        if frappe.db.exists("Kiosk Face Data", self.name):
            frappe.delete_doc("Kiosk Face Data", self.name, ignore_permissions=True, force=True)
