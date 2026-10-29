//@api 1
//@name dice
//@author hazelle
//@display-name 주사위
//@version 1.0.0
//@tool {"name":"roll","description":"Rolls a die with the given number of sides.","parameters":{"type":"object","properties":{"sides":{"type":"number"}},"required":["sides"]}}

/* global hazelle */

hazelle.on('tool', async (chat, name, args) => {
  await chat.state.set('sides', args.sides);
  return String(Math.min(17, args.sides));
});
