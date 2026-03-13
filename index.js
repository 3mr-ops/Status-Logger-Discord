const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
  Events
} = require("discord.js");

const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = "1482116768414699630";
const ADMIN_USER_ID = "382984064564723714";

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const WATCHED_FILE = path.join(DATA_DIR, "watched-users.json");

function loadWatchedUsers() {
  try {
    if (!fs.existsSync(WATCHED_FILE)) {
      fs.writeFileSync(
        WATCHED_FILE,
        JSON.stringify(["382984064564723714"], null, 2)
      );
    }

    const data = JSON.parse(fs.readFileSync(WATCHED_FILE, "utf8"));
    return new Set(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("Failed to load watched users:", err);
    return new Set();
  }
}

function saveWatchedUsers(set) {
  fs.writeFileSync(WATCHED_FILE, JSON.stringify([...set], null, 2));
}

const watchedUsers = loadWatchedUsers();
const sessionStarts = new Map();

const STATUS_CONFIG = {
  online: { label: "Online", icon: "🟢", color: 0x57f287 },
  idle: { label: "Idle", icon: "🌙", color: 0xfee75c },
  dnd: { label: "Do Not Disturb", icon: "⛔", color: 0xed4245 },
  offline: { label: "Offline", icon: "⚫", color: 0x747f8d }
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function getStatusName(presence) {
  if (!presence) return "offline";
  return presence.status || "offline";
}

function getStatusDisplay(status) {
  return STATUS_CONFIG[status] || { label: status, icon: "❔", color: 0x5865f2 };
}

function getPlatformInfo(presence) {
  const cs = presence?.clientStatus;
  if (!cs) return "Offline / Unknown";

  const out = [];
  if (cs.desktop) out.push("PC");
  if (cs.mobile) out.push("Mobile");
  if (cs.web) out.push("Web");
  return out.length ? out.join(", ") : "Unknown";
}

function getActivities(presence) {
  const result = {
    game: null,
    streaming: null,
    spotify: null
  };

  if (!presence?.activities?.length) return result;

  for (const a of presence.activities) {

    if (a.type === ActivityType.Playing && !result.game) {
      result.game = a.name || null;
    }

    if (a.type === ActivityType.Streaming && !result.streaming) {
      result.streaming = a.name || "Streaming";
    }

    if (a.type === ActivityType.Listening && a.name === "Spotify" && !result.spotify) {
      const track = a.details || "Unknown track";
      const artist = a.state || "Unknown artist";
      result.spotify = `${track} — ${artist}`;
    }
  }

  return result;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0m";
  const totalSeconds = Math.floor(ms / 1000);
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);

  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

function buildPresenceEmbed(member, userId, oldPresence, newPresence) {
  const oldStatus = getStatusName(oldPresence);
  const newStatus = getStatusName(newPresence);

  const oldA = getActivities(oldPresence);
  const newA = getActivities(newPresence);

  const displayName =
    member?.displayName ||
    newPresence?.user?.username ||
    oldPresence?.user?.username ||
    userId;

  const avatar =
    member?.user?.displayAvatarURL?.({ size: 256 }) ||
    newPresence?.user?.displayAvatarURL?.({ size: 256 }) ||
    oldPresence?.user?.displayAvatarURL?.({ size: 256 }) ||
    null;

  const statusInfo = getStatusDisplay(newStatus);
  const oldStatusInfo = getStatusDisplay(oldStatus);
  const platform = getPlatformInfo(newPresence || oldPresence);
  const nowUnix = Math.floor(Date.now() / 1000);

  let sessionText = "Not tracked yet";

  if (newStatus !== "offline" && oldStatus === "offline") {
    sessionStarts.set(userId, Date.now());
    sessionText = "Session started now";
  } else if (newStatus === "offline") {
    const started = sessionStarts.get(userId);
    if (started) {
      sessionText = `Online for ${formatDuration(Date.now() - started)}`;
      sessionStarts.delete(userId);
    }
  } else {
    const started = sessionStarts.get(userId);
    if (started) {
      sessionText = `Online for ${formatDuration(Date.now() - started)}`;
    }
  }

  const changes = [];

  if (oldStatus !== newStatus) {
    changes.push(`${oldStatusInfo.icon} **${oldStatusInfo.label}** → ${statusInfo.icon} **${statusInfo.label}**`);
  }

  if (oldA.game !== newA.game) {
    if (!oldA.game && newA.game) changes.push(`🎮 Started playing **${newA.game}**`);
    else if (oldA.game && !newA.game) changes.push(`🛑 Stopped playing **${oldA.game}**`);
    else changes.push(`🔄 Switched game: **${oldA.game}** → **${newA.game}**`);
  }

  if (!changes.length) return null;

  const embed = new EmbedBuilder()
    .setColor(statusInfo.color)
    .setAuthor({ name: `${displayName} status update`, iconURL: avatar || undefined })
    .setThumbnail(avatar)
    .addFields(
      { name: "Changes", value: changes.join("\n") },
      { name: "Platform", value: platform, inline: true },
      { name: "Session", value: sessionText, inline: true },
      { name: "User ID", value: `\`${userId}\`` }
    )
    .setFooter({ text: "Status Logger" })
    .setTimestamp();

  return embed;
}

client.once(Events.ClientReady, () => {
  console.log(`Bot is online as ${client.user.tag}`);
  console.log(`Watching ${watchedUsers.size} users`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.author.id !== ADMIN_USER_ID) return;

  const parts = message.content.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  if (cmd === "!watch") {
    const id = parts[1]?.replace(/[<@!>]/g, "");
    if (!id) return message.reply("Usage: `!watch USER_ID` or `!watch @user`");

    watchedUsers.add(id);
    saveWatchedUsers(watchedUsers);
    return message.reply(`Now watching \`${id}\``);
  }

  if (cmd === "!watchlist") {
    if (!watchedUsers.size) {
      return message.reply("No watched users.");
    }

    const lines = [];
    for (const id of watchedUsers) {
      const user = await client.users.fetch(id).catch(() => null);
      if (user) lines.push(`• **${user.username}** (\`${id}\`)`);
    }

    return message.reply(`**Watched Users**\n${lines.join("\n")}`);
  }
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  const userId = newPresence?.userId || oldPresence?.userId;
  if (!userId || !watchedUsers.has(userId)) return;

  const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const member = newPresence?.member || oldPresence?.member;
  const embed = buildPresenceEmbed(member, userId, oldPresence, newPresence);
  if (!embed) return;

  await channel.send({ embeds: [embed] });
});

client.login(TOKEN);
