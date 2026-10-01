import frappe

# Worker PINs are NEVER stored in a normal field. They are hashed (same
# pbkdf2 hashing Frappe uses for user passwords) and kept in Frappe's hidden
# __Auth table under this fieldname, which no API/report can read back.
PIN_FIELD = "kiosk_pin"


def validate_pin_format(pin):
    pin = str(pin or "").strip()
    if not pin.isdigit() or not 4 <= len(pin) <= 6:
        frappe.throw("PIN must be 4 to 6 digits (numbers only).")
    if len(set(pin)) == 1 or pin in "0123456789" or pin in "9876543210":
        frappe.throw("That PIN is too easy to guess (like 1111 or 1234). Please choose another.")
    return pin
