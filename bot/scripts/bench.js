'use strict';
require('dotenv').config();

const models = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];
const prompt = 'You are CenterSide, support agent. Answer in 2 sentences.';

(async () => {
  for (const model of models) {
    const times = [];
    for (let i = 0; i < 4; i += 1) {
      const t = Date.now();
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AI_API_KEY}` },
        body: JSON.stringify({
          model,
          temperature: 0.5,
          reasoning_effort: 'low',
          max_tokens: 160,
          messages: [{ role: 'system', content: prompt }, { role: 'user', content: 'where do i open a ticket?' }],
        }),
      });
      const json = await res.json();
      times.push(`${Date.now() - t}ms${json.choices ? '' : ' ERR'}`);
    }
    console.log(model.padEnd(22), times.join('  '));
  }
})();
