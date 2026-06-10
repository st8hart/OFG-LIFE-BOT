require('dotenv').config();
const { REST, Routes } = require('discord.js');
const {
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
  challengeCommand,
  standingsCommand,
  myPersonalGoalCommand,
  teamGoalsCommand,
  editSaleCommand,
  myEditSaleCommand,
  challengesCommand,
} = require('./commands');

const commands = [
  saleCommand, leaderboardCommand, myStatsCommand, teamStatsCommand,
  recentSalesCommand, deleteSaleCommand, removeSaleCommand, setGoalCommand,
  challengeCommand,
  standingsCommand,
  myPersonalGoalCommand,
  teamGoalsCommand,
  editSaleCommand,
  myEditSaleCommand,
  challengesCommand,
].map(cmd => cmd.data.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('Commands registered successfully!');
    commands.forEach(cmd => console.log(`  /${cmd.name}`));
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();
