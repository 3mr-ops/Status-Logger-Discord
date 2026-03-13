```js
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

/* ---------------- WATCHLIST STORAGE ---------------- */

function loadWatchedUsers() {
  try {
    if (!fs.existsSync(WATCHED_FILE)) {
      fs.writeFileSync(WATCHED_FILE, JSON.stringify([ADMIN_USER_ID], null, 2));
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

/* ---------------- STATUS CONFIG ---------------- */

const STATUS_CONFIG = {
  online: { label: "Online", icon: "🟢", color: 0x57f287 },
  idle: { label: "Idle", icon: "🌙", color: 0xfee75c },
  dnd: { label: "Do Not Disturb", icon: "⛔", color: 0xed4245 },
  offline: { label: "Offline", icon: "⚫", color: 0x747f8d }
};

/* ---------------- CLIENT ---------------- */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ---------------- HELPERS ---------------- */

function getStatusName(presence) {
  if (!presence) return "offline";
  return presence.status || "offline";
}

function getStatusDisplay(status) {
  return STATUS_CONFIG[status] || { label: status, icon: "❔", color: 0x5865f2 };
}

function getPlatformInfo(presence) {
  const cs = presence?.clientStatus;
  if (!cs) return "Offline";

  const out = [];
  if (cs.desktop) out.push("💻 PC");
  if (cs.mobile) out.push("📱 Mobile");
  if (cs.web) out.push("🌐 Web");

  return out.join(", ") || "Unknown";
}

/* ---------------- ACTIVITY DETECTION ---------------- */

function getActivities(presence) {
  const result = {
    game: null,
    streaming: null,
    spotify: null,
    spotifyCover: null
  };

  if (!presence?.activities?.length) return result;

  for (const a of presence.activities) {

    if (a.type === ActivityType.Playing && !result.game) {
      result.game = a.name || null;
    }

    if (a.type === ActivityType.Streaming && !result.streaming) {
      result.streaming = a.name || "Streaming";
    }

    if (a.type === ActivityType.Listening && a.name === "Spotify") {

      const track = a.details || "Unknown track";
      const artist = a.state || "Unknown artist";

      result.spotify = track + " — " + artist;

      if (a.assets?.largeImage) {
        const img = a.assets.largeImage.replace("spotify:", "");
        result.spotifyCover = "https://i.scdn.co/image/" + img;
      }
    }
  }

  return result;
}

/* ---------------- TIME FORMAT ---------------- */

function formatDuration(ms) {
  if (!ms) return "0m";

  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);

  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ---------------- EMBED BUILDER ---------------- */

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
    member?.user?.displayAvatarURL({ size: 256 }) ||
    null;

  const statusInfo = getStatusDisplay(newStatus);
  const oldStatusInfo = getStatusDisplay(oldStatus);
  const platform = getPlatformInfo(newPresence || oldPresence);

  const nowUnix = Math.floor(Date.now() / 1000);

  let sessionText = "Tracking...";

  if (newStatus !== "offline" && oldStatus === "offline") {
    sessionStarts.set(userId, Date.now());
    sessionText = "Session started";
  }

  else if (newStatus === "offline") {
    const start = sessionStarts.get(userId);
    if (start) {
      sessionText = "Online for " + formatDuration(Date.now() - start);
      sessionStarts.delete(userId);
    }
  }

  else {
    const start = sessionStarts.get(userId);
    if (start) {
      sessionText = "Online for " + formatDuration(Date.now() - start);
    }
  }

  const changes = [];

  if (oldStatus !== newStatus) {
    changes.push(`${oldStatusInfo.icon} ${oldStatusInfo.label} → ${statusInfo.icon} ${statusInfo.label}`);
  }

  if (oldA.game !== newA.game) {

    if (!oldA.game && newA.game)
      changes.push(`🎮 Started playing **${newA.game}**`);

    else if (oldA.game && !newA.game)
      changes.push(`🛑 Stopped playing **${oldA.game}**`);

    else
      changes.push(`🔄 Switched game: **${oldA.game} → ${newA.game}**`);
  }

  if (oldA.streaming !== newA.streaming) {

    if (!oldA.streaming && newA.streaming)
      changes.push(`📺 Started streaming **${newA.streaming}**`);

    else if (oldA.streaming && !newA.streaming)
      changes.push(`📴 Stopped streaming`);
  }

  if (oldA.spotify !== newA.spotify) {

    if (!oldA.spotify && newA.spotify)
      changes.push(`🎵 Listening on Spotify\n**${newA.spotify}**`);

    else if (oldA.spotify && !newA.spotify)
      changes.push(`⏹️ Stopped Spotify`);
  }

  if (!changes.length) return null;

  const embed = new EmbedBuilder()
    .setColor(statusInfo.color)
    .setAuthor({
      name: displayName + " activity",
      iconURL: avatar
    })
    .setThumbnail(newA.spotifyCover || avatar)
    .addFields(
      { name: "Changes", value: changes.join("\n") },
      { name: "Platform", value: platform, inline: true },
      { name: "Session", value: sessionText, inline: true },
      { name: "User ID", value: "`" + userId + "`" }
    )
    .setFooter({ text: "Status Logger" })
    .setTimestamp();

  return embed;
}

/* ---------------- BOT READY ---------------- */

client.once(Events.ClientReady, () => {

  console.log("Bot online as " + client.user.tag);
  console.log("Watching " + watchedUsers.size + " users");

});

/* ---------------- COMMANDS ---------------- */

client.on(Events.MessageCreate, async message => {

  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.author.id !== ADMIN_USER_ID) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args[0]?.toLowerCase();

  if (cmd === "!watch") {

    const id = args[1]?.replace(/[<@!>]/g, "");
    if (!id) return message.reply("Usage: !watch USER_ID");

    watchedUsers.add(id);
    saveWatchedUsers(watchedUsers);

    message.reply("Now watching `" + id + "`");
  }

  if (cmd === "!watchlist") {

    if (!watchedUsers.size)
      return message.reply("No watched users.");

    const lines = [];

    for (const id of watchedUsers) {
      const user = await client.users.fetch(id).catch(() => null);
      if (user)
        lines.push("• **" + user.username + "** (`" + id + "`)");
    }

    message.reply("**Watched Users**\n" + lines.join("\n"));
  }

});

/* ---------------- PRESENCE TRACKING ---------------- */

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {

  const userId = newPresence?.userId || oldPresence?.userId;

  if (!userId || !watchedUsers.has(userId)) return;

  const channel = await client.channels
    .fetch(LOG_CHANNEL_ID)
    .catch(() => null);

  if (!channel || !channel.isTextBased()) return;

  const member = newPresence?.member || oldPresence?.member;

  const embed = buildPresenceEmbed(member, userId, oldPresence, newPresence);

  if (!embed) return;

  channel.send({ embeds: [embed] });

});

/* ---------------- LOGIN ---------------- */

client.login(TOKEN);
```
