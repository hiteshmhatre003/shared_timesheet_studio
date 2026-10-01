# Copyright (c) 2026, Amal Embroideries Private Limited
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint


class KioskSettings(Document):
    def validate(self):
        secs = cint(self.worker_session_seconds)
        if secs and not 20 <= secs <= 600:
            frappe.throw("Auto sign-out must be between 20 and 600 seconds.")
        if self.max_pin_attempts and cint(self.max_pin_attempts) < 3:
            frappe.throw("Allow at least 3 PIN attempts before locking.")
        if self.lockout_minutes and cint(self.lockout_minutes) < 1:
            frappe.throw("Lock duration must be at least 1 minute.")
