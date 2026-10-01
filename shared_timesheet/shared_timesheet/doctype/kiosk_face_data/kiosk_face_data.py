# Copyright (c) 2026, Amal Embroideries Private Limited
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class KioskFaceData(Document):
    # One row per worker: the face "measurements" (not photos) captured when a
    # Timesheet Manager registered the worker on the kiosk. Only the kiosk API
    # writes here. Deleting this row removes the worker's face registration.
    def on_trash(self):
        if frappe.db.exists("Kiosk Worker", self.worker):
            frappe.db.set_value("Kiosk Worker", self.worker, {"has_face": 0, "face_registered_on": None})
