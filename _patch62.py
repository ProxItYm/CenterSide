import pathlib

# ---------- modaltest: describe form ----------
m = pathlib.Path(r"C:\Users\maxis\CenterSide\bot\scripts\modaltest.js")
s = m.read_text(encoding="utf-8")
s = s.replace("check('panel:lanes (five option slots)', () => {",
"""check('describe:form (five fields)', () => {
  const modal = new ModalBuilder().setCustomId('describe:form').setTitle('Describe your server');
  [
    ['server', 'Server name', TextInputStyle.Short, 80],
    ['about', 'What is this server about?', TextInputStyle.Paragraph, 700],
    ['tone', 'Tone (or leave blank for friendly)', TextInputStyle.Short, 40],
    ['hours', 'Support hours', TextInputStyle.Short, 70],
    ['facts', 'Facts it must never get wrong', TextInputStyle.Paragraph, 700],
  ].forEach(([id, label, style, max]) => {
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId(id).setLabel(label).setStyle(style).setMaxLength(max).setRequired(false)));
  });
  return modal;
});

check('panel:lanes (five option slots)', () => {""")
m.write_text(s, encoding="utf-8")

# ---------- deploy: global for public, clean up guild copies ----------
d = pathlib.Path(r"C:\Users\maxis\CenterSide\bot\src\deploy-commands.js")
ds = d.read_text(encoding="utf-8")
ds = ds.replace("""  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`Registered ${commands.length} commands globally (can take up to an hour to appear).`);
  }""",
"""  } else {
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log(`Registered ${commands.length} commands globally (can take up to an hour to appear).`);

    // Remove per-guild copies from servers this install already knows about, or
    // every command appears twice in those guilds.
    try {
      const state = JSON.parse(require('node:fs').readFileSync(config.stateFile, 'utf8'));
      for (const guildId of Object.keys(state.guilds || {})) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), { body: [] });
        console.log(`Cleared guild-scoped commands in ${guildId}.`);
      }
    } catch {
      // no state file yet — nothing to clear
    }
  }""")
d.write_text(ds, encoding="utf-8")
print("ok")
