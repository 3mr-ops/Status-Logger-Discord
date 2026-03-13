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

if (!TOKEN) {
  throw new Error("TOKEN environment variable is missing.");
}

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const WATCHED_FILE = path.join(DATA_DIR, "watched-users.json");

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
  fs.writeFileSync(WATCHED_FILE, JSON.stringify(Array.from(set), null, 2));
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
  if (STATUS_CONFIG[status]) return STATUS_CONFIG[status];
  return { label: String(status), icon: "❔", color: 0x5865f2 };
}

function getPlatformInfo(presence) {
  const cs = presence && presence.clientStatus;
  if (!cs) return "Offline";

  const out = [];
  if (cs.desktop) out.push("💻 PC");
  if (cs.mobile) out.push("📱 Mobile");
  if (cs.web) out.push("🌐 Web");

  if (!out.length) return "Unknown";
  return out.join(", ");
}

function getActivities(presence) {
  const result = {
    game: null,
    streaming: null,
    spotify: null,
    spotifyTrack: null,
    spotifyArtist: null,
    spotifyCover: null
  };

  if (!presence || !presence.activities || !presence.activities.length) {
    return result;
  }

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

      result.spotifyTrack = track;
      result.spotifyArtist = artist;
      result.spotify = track + " — " + artist;

      if (a.assets && a.assets.largeImage) {
        const raw = a.assets.largeImage;
        const cleaned = String(raw).replace("spotify:", "");
        result.spotifyCover = "https://i.scdn.co/image/" + cleaned;
      }
    }
  }

  return result;
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0m";

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts = [];
  if (days > 0) parts.push(String(days) + "d");
  if (hours > 0) parts.push(String(hours) + "h");
  parts.push(String(minutes) + "m");

  return parts.join(" ");
}

function buildPresenceEmbed(member, userId, oldPresence, newPresence) {
  const oldStatus = getStatusName(oldPresence);
  const newStatus = getStatusName(newPresence);

  const oldA = getActivities(oldPresence);
  const newA = getActivities(newPresence);

  const displayName =
    (member && member.displayName) ||
    (newPresence && newPresence.user && newPresence.user.username) ||
    (oldPresence && oldPresence.user && oldPresence.user.username) ||
    userId;

  const avatar =
    (member &&
      member.user &&
      typeof member.user.displayAvatarURL === "function" &&
      member.user.displayAvatarURL({ size: 256 })) ||
    (newPresence &&
      newPresence.user &&
      typeof newPresence.user.displayAvatarURL === "function" &&
      newPresence.user.displayAvatarURL({ size: 256 })) ||
    (oldPresence &&
      oldPresence.user &&
      typeof oldPresence.user.displayAvatarURL === "function" &&
      oldPresence.user.displayAvatarURL({ size: 256 })) ||
    null;

  const statusInfo = getStatusDisplay(newStatus);
  const oldStatusInfo = getStatusDisplay(oldStatus);
  const platform = getPlatformInfo(newPresence || oldPresence);

  let sessionText = "Tracking...";
  if (newStatus !== "offline" && oldStatus === "offline") {
    sessionStarts.set(userId, Date.now());
    sessionText = "Session started";
  } else if (newStatus === "offline") {
    const started = sessionStarts.get(userId);
    if (started) {
      sessionText = "Online for " + formatDuration(Date.now() - started);
      sessionStarts.delete(userId);
    } else {
      sessionText = "Went offline";
    }
  } else {
    const started = sessionStarts.get(userId);
    if (started) {
      sessionText = "Online for " + formatDuration(Date.now() - started);
    } else {
      sessionStarts.set(userId, Date.now());
      sessionText = "Session started";
    }
  }

  const changes = [];

  if (oldStatus !== newStatus) {
    changes.push(
      oldStatusInfo.icon +
        " " +
        oldStatusInfo.label +
        " → " +
        statusInfo.icon +
        " " +
        statusInfo.label
    );
  }

  if (oldA.game !== newA.game) {
    if (!oldA.game && newA.game) {
      changes.push("🎮 Started playing **" + newA.game + "**");
    } else if (oldA.game && !newA.game) {
      changes.push("🛑 Stopped playing **" + oldA.game + "**");
    } else if (oldA.game && newA.game) {
      changes.push("🔄 Switched game: **" + oldA.game + "** → **" + newA.game + "**");
    }
  }

  if (oldA.streaming !== newA.streaming) {
    if (!oldA.streaming && newA.streaming) {
      changes.push("📺 Started streaming **" + newA.streaming + "**");
    } else if (oldA.streaming && !newA.streaming) {
      changes.push("📴 Stopped streaming");
    } else if (oldA.streaming && newA.streaming) {
      changes.push("📺 Changed stream: **" + oldA.streaming + "** → **" + newA.streaming + "**");
    }
  }

  if (oldA.spotify !== newA.spotify) {
    if (!oldA.spotify && newA.spotify) {
      changes.push("🎵 Listening on Spotify");
    } else if (oldA.spotify && !newA.spotify) {
      changes.push("⏹️ Stopped Spotify");
    } else if (oldA.spotify && newA.spotify) {
      changes.push("🎵 Changed Spotify track");
    }
  }

  if (!changes.length) return null;

  const embed = new EmbedBuilder()
    .setColor(statusInfo.color)
    .setTitle(displayName + " activity update")
    .addFields(
      { name: "Changes", value: changes.join("\n"), inline: false },
      { name: "Platform", value: platform, inline: true },
      { name: "Session", value: sessionText, inline: true },
      { name: "User ID", value: "`" + userId + "`", inline: false }
    )
    .setFooter({ text: "Status Logger" })
    .setTimestamp();

  if (avatar) {
    embed.setAuthor({
      name: displayName,
      iconURL: avatar
    });
  }

  if (newA.spotify) {
    embed.addFields(
      { name: "Track", value: newA.spotifyTrack || "Unknown track", inline: false },
      { name: "Artist", value: newA.spotifyArtist || "Unknown artist", inline: false }
    );

    if (newA.spotifyCover) {
      embed.setThumbnail(newA.spotifyCover);
    } else if (avatar) {
      embed.setThumbnail(avatar);
    }
  } else if (avatar) {
    embed.setThumbnail(avatar);
  }

  return embed;
}

client.once(Events.ClientReady, function () {
  console.log("Bot online as " + client.user.tag);
  console.log("Watching " + watchedUsers.size + " users");
});

client.on(Events.MessageCreate, async function (message) {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.author.id !== ADMIN_USER_ID) return;

  const args = message.content.trim().split(/\s+/);
  const cmd = args[0] ? args[0].toLowerCase() : "";

  if (cmd === "!watch") {
    const id = args[1] ? args[1].replace(/[<@!>]/g, "") : "";
    if (!id) {
      return message.reply("Usage: !watch USER_ID or !watch @user");
    }

    watchedUsers.add(id);
    saveWatchedUsers(watchedUsers);
    return message.reply("Now watching `" + id + "`");
  }

  if (cmd === "!unwatch") {
    const id = args[1] ? args[1].replace(/[<@!>]/g, "") : "";
    if (!id) {
      return message.reply("Usage: !unwatch USER_ID or !unwatch @user");
    }

    watchedUsers.delete(id);
    saveWatchedUsers(watchedUsers);
    sessionStarts.delete(id);
    return message.reply("Stopped watching `" + id + "`");
  }

  if (cmd === "!watchlist") {
    if (!watchedUsers.size) {
      return message.reply("No watched users.");
    }

    const lines = [];

    for (const id of watchedUsers) {
      const user = await client.users.fetch(id).catch(function () {
        return null;
      });

      if (user) {
        const label = user.globalName || user.username;
        lines.push("• **" + label + "** (`" + id + "`)");
      } else {
        lines.push("• Unknown user (`" + id + "`)");
      }
    }

    return message.reply("**Watched Users**\n" + lines.join("\n"));
  }
});

client.on(Events.PresenceUpdate, async function (oldPresence, newPresence) {
  try {
    const userId =
      (newPresence && newPresence.userId) ||
      (oldPresence && oldPresence.userId);

    if (!userId) return;
    if (!watchedUsers.has(userId)) return;

    const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(function () {
      return null;
    });

    if (!channel || !channel.isTextBased()) return;

    const member =
      (newPresence && newPresence.member) ||
      (oldPresence && oldPresence.member);

    const embed = buildPresenceEmbed(member, userId, oldPresence, newPresence);
    if (!embed) return;

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Error in presenceUpdate:", err);
  }
});

client.login(TOKEN);
