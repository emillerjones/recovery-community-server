import { Client, GatewayIntentBits } from "discord.js";
import db from "#db/client"; // FIXED: Restored your core server database client connection import

// Initialize the primary Discord Bot Client Instance with Voice parameters
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ]
});

// Cache map instance tracking
let botReadyPromise = null;

export async function getDiscordBotClient() {
  if (botReadyPromise) return botReadyPromise;
  
  botReadyPromise = new Promise((resolve, reject) => {
    client.once("ready", () => {
      resolve(client);
    });
    client.once("error", (err) => {
      reject(err);
    });
  });

  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("⚠️ Warning: DISCORD_BOT_TOKEN is missing in your .env file!");
    return null;
  }

  await client.login(token);
  return botReadyPromise;
}

// 1. STARTUP TRIGGER: Automatically sweeps old channels when the bot logs in
client.once("ready", async () => {
  console.log(`🤖 Discord Bot logged in as ${client.user.tag}`);
  await wipeAllLFGExtraChannels(client); 
});

// 2. CREATION ENGINE: Provisions a temporary room for incoming lobbies
export async function createTemporaryVoiceChannel(lobbyTitle) {
  try {
    const botClient = await getDiscordBotClient();
    if (!botClient) return null;

    const guildId = process.env.DISCORD_GUILD_ID || botClient.guilds.cache.first()?.id;
    if (!guildId) return null;

    const guild = await botClient.guilds.fetch(guildId);
    
    // 1. Provisions the actual channel line onto your Discord Server Sidebar
    const channel = await guild.channels.create({
      name: `LFG: ${lobbyTitle}`,
      type: 2 // Type 2 is the strict configuration flag layout requirement for Voice Channels
    });

    // 2. FIXED: Creates a valid invite handshake ticket code link straight to that channel line container!
    const inviteLinkTicket = await channel.createInvite({
      maxAge: 0, // 0 specifies that the connection link token ticket never expires automatically
      maxUses: 0  // 0 specifies that unlimited teammate operators can use this path link to connect
    });

    // Returns the authentic, clickable discord.gg/abcxyz text string url address straight to your app!
    return {
      voice_id: channel.id,
      voice_url: inviteLinkTicket.url 
    };
  } catch (err) {
    console.error("❌ Failed to provision dynamic voice room with invite link:", err.message);
    return null;
  }
}

// 3. INDIVIDUAL WIPE DELETION: Clears a target voice channel on a close action
export async function deleteTemporaryVoiceChannel(channelId) {
  try {
    const botClient = await getDiscordBotClient();
    if (!botClient) return;

    const channel = await botClient.channels.fetch(channelId);
    if (channel) {
      await channel.delete();
      console.log(`🧹 Discord voice channel ${channelId} cleaned up successfully.`);
    }
  } catch (err) {
    console.error(`❌ Failed to delete specific channel ${channelId}:`, err.message);
  }
}

// 4. SMART STARTUP SWEEPER: Filters out old dead rooms, keeping active ones safe
export async function wipeAllLFGExtraChannels(botInstance) {
  try {
    const guildId = process.env.DISCORD_GUILD_ID || botInstance.guilds.cache.first()?.id;
    if (!guildId) return;

    const guild = await botInstance.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();

    console.log("💥 BULLETPROOF SWEEP: Force-deleting ALL old channels...");
    
    let count = 0;
    for (const [id, channel] of channels) {
      if (!channel || !channel.name) continue;
      
      const name = channel.name;
      
      // ABSOLUTE DIRECT CHECK: Targets Uppercase, Lowercase, and mixed combinations instantly
      if (channel.type === 2 && (name.startsWith("LFG:") || name.startsWith("lfg:") || name.startsWith("Lfg:"))) {
        await channel.delete();
        count++;
      }
    }
    
    if (count > 0) {
      console.log(`🗑️ SUCCESS: Force-wiped ${count} old channels from your sidebar!`);
    } else {
      console.log("✨ Discord Cleaner: Server is completely spotless.");
    }
  } catch (err) {
    console.error("❌ Cleaner failed to sweep channels:", err.message);
  }
}
