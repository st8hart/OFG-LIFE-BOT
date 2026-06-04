// src/deploy-commands.js
// Run this ONCE to register slash commands with Discord:
//   node src/deploy-commands.js

require('dotenv').config();
const { REST, Routes } = require('discord.js');
const {
  saleCommand,
  leaderboardCommand,
  myStatsCommand,
  recentSalesCommand,
  deleteSaleCommand,
  setGoalCommand,
} = require('./commands');

const commands = [
  saleCommand,
  leaderboardCommand,
  myStatsCommand,
  recentSalesCommand,
  deleteSaleCommand,
  setGoalCommand,
].map(cmd => cmd.data.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('🔄 Registering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Commands registered successfully!');
    console.log('Commands available:');
    commands.forEach(cmd => console.log(`  /${cmd.name} — ${cmd.description}`));
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
