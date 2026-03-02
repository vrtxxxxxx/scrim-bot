const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

// ===== RENDER ENV VARIABLES =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// =================================

const MANAGER_ROLES = ["Scrim Manager", "Scrim Leader"];
const RESET_ROLE = "Founder Knight";

const MAX_STARTERS = 5;
const MAX_SUBS = 2;

const ROLE_LIMITS = {
  AR: 3,
  SMG: 3,
  LMG: 1,
  SG: 1,
  MRK: 1,
  SNP: 1
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let scrims = [];

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [
      new SlashCommandBuilder()
        .setName("guncheck")
        .setDescription("Start scrim gun check")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("resetscrims")
        .setDescription("Reset all scrims")
        .toJSON()
    ]
  });

  console.log("Slash commands registered.");
});

function buildEmbed(scrim, index) {
  const embed = new EmbedBuilder()
    .setTitle(`🎮 Scrim Gun Check — Scrim ${index + 1}`)
    .setColor("Red")
    .setDescription(
      `First ${MAX_STARTERS} players to lock 2 roles become starters.\n` +
      `Subs limited to ${MAX_SUBS}.`
    );

  const starters = scrim.lockedPlayers.map(id =>
    `<@${id}> — ${scrim.userRoles[id].join(" / ")}`
  );

  embed.addFields({
    name: `Starters (${scrim.lockedPlayers.length}/${MAX_STARTERS})`,
    value: starters.length ? starters.join("\n") : "None"
  });

  const selecting = Object.keys(scrim.userRoles)
    .filter(id =>
      scrim.userRoles[id].length === 1 &&
      !scrim.lockedPlayers.includes(id)
    )
    .map(id =>
      `<@${id}> — ${scrim.userRoles[id].join(" / ")}`
    );

  embed.addFields({
    name: "Still Selecting",
    value: selecting.length ? selecting.join("\n") : "None"
  });

  const subs = scrim.subs.map(id => `<@${id}>`);

  embed.addFields({
    name: `Subs (${scrim.subs.length}/${MAX_SUBS})`,
    value: subs.length ? subs.join("\n") : "None"
  });

  return embed;
}

function createButtons(index) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`AR-${index}`).setLabel("AR").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`SMG-${index}`).setLabel("SMG").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`LMG-${index}`).setLabel("LMG").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`SG-${index}`).setLabel("SG").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`MRK-${index}`).setLabel("MRK").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`SNP-${index}`).setLabel("SNP").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`SUB-${index}`).setLabel("SUB").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`CANCEL-${index}`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
    )
  ];
}

async function refreshAllScrimMessages() {
  for (let i = 0; i < scrims.length; i++) {
    const scrim = scrims[i];
    if (!scrim.message) continue;

    await scrim.message.edit({
      embeds: [buildEmbed(scrim, i)],
      components: createButtons(i)
    });
  }
}

client.on("interactionCreate", async interaction => {

  // ===== SLASH COMMANDS =====
  if (interaction.isChatInputCommand()) {

    // RESET
    if (interaction.commandName === "resetscrims") {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === RESET_ROLE)) {
        return interaction.reply({ content: "No permission.", ephemeral: true });
      }
      scrims = [];
      return interaction.reply("Scrims reset.");
    }

    // GUNCHECK
    if (interaction.commandName === "guncheck") {

      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => MANAGER_ROLES.includes(r.name))) {
        return interaction.reply({
          content: "Only Scrim Leaders or Managers can use this.",
          ephemeral: true
        });
      }

      const scrim = {
        userRoles: {},
        roleCounts: { AR:0, SMG:0, LMG:0, SG:0, MRK:0, SNP:0 },
        lockedPlayers: [],
        subs: [],
        message: null
      };

      scrims.push(scrim);
      const index = scrims.length - 1;

      const reply = await interaction.reply({
        embeds: [buildEmbed(scrim, index)],
        components: createButtons(index),
        fetchReply: true
      });

      scrim.message = reply;
    }
  }

  // ===== BUTTONS =====
  if (!interaction.isButton()) return;

  const [action, indexStr] = interaction.customId.split("-");
  const index = parseInt(indexStr);
  const scrim = scrims[index];
  if (!scrim) return;

  const userId = interaction.user.id;

  if (!scrim.userRoles[userId]) scrim.userRoles[userId] = [];

  // CANCEL
  if (action === "CANCEL") {
    const member = await interaction.guild.members.fetch(userId);
    if (!member.roles.cache.some(r => MANAGER_ROLES.includes(r.name))) {
      return interaction.reply({ content: "No permission.", ephemeral: true });
    }

    await scrim.message.delete();
    scrims.splice(index, 1);
    await refreshAllScrimMessages();
    return;
  }

  // SUB
  if (action === "SUB") {

    if (!scrim.subs.includes(userId) && scrim.subs.length >= MAX_SUBS) {
      return interaction.reply({ content: "Sub slots full.", ephemeral: true });
    }

    for (const role of scrim.userRoles[userId]) {
      scrim.roleCounts[role]--;
    }

    scrim.lockedPlayers =
      scrim.lockedPlayers.filter(id => id !== userId);

    scrim.userRoles[userId] = [];

    if (scrim.subs.includes(userId))
      scrim.subs = scrim.subs.filter(id => id !== userId);
    else
      scrim.subs.push(userId);

  } else {

    // Block weapon if SUB
    if (scrim.subs.includes(userId)) {
      return interaction.reply({
        content: "You are marked as SUB. Remove SUB to choose weapons.",
        ephemeral: true
      });
    }

    // Remove role if clicked again
    if (scrim.userRoles[userId].includes(action)) {

      scrim.userRoles[userId] =
        scrim.userRoles[userId].filter(r => r !== action);

      scrim.roleCounts[action]--;

      scrim.lockedPlayers =
        scrim.lockedPlayers.filter(id => id !== userId);

    } else {

      if (
        scrim.lockedPlayers.length >= MAX_STARTERS &&
        !scrim.lockedPlayers.includes(userId)
      ) {
        return interaction.reply({
          content: "Starter slots full.",
          ephemeral: true
        });
      }

      if (scrim.roleCounts[action] >= ROLE_LIMITS[action]) {
        return interaction.reply({
          content: `${action} full.`,
          ephemeral: true
        });
      }

      if (scrim.userRoles[userId].length >= 2) {
        return interaction.reply({
          content: "Max 2 roles.",
          ephemeral: true
        });
      }

      scrim.userRoles[userId].push(action);
      scrim.roleCounts[action]++;

      if (scrim.userRoles[userId].length === 2) {
        scrim.lockedPlayers.push(userId);

        if (scrim.lockedPlayers.length === MAX_STARTERS) {
          scrim.message.channel.send(
            `🔥 **Lineup Full for Scrim ${index + 1}!**`
          );
        }
      }
    }
  }

  await scrim.message.edit({
    embeds: [buildEmbed(scrim, index)],
    components: createButtons(index)
  });

  interaction.deferUpdate();
});

client.login(TOKEN);