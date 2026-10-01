# Copyright (c) 2026, Amal Embroideries Private Limited
# For license information, please see license.txt

from frappe.model.document import Document


class KioskPunchLog(Document):
    # Read-only audit trail. Rows are only ever created by
    # shared_timesheet.api (start/stop/manual/edit/delete/submit/wrong PIN),
    # each with the photo the tablet took when the worker entered their PIN.
    pass
