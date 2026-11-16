import pathlib

h = pathlib.Path(r"C:\Users\maxis\CenterSide\bot\src\handlers.js")
s = h.read_text(encoding="utf-8")

s = s.replace("""    const message = 'Something broke on the bench. The error is in the console — try again, or close and reopen the ticket.';""",
"""    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    const detail = isAdmin ? `\\n\\n\\`${err.message || err}\\`` : '';
    const message = `Something broke on the bench. The error is in the console — try again, or close and reopen the ticket.${detail}`;""")

h.write_text(s, encoding="utf-8")
print("error detail for admins:", "isAdmin" in s)
