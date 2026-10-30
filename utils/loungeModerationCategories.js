// Plain-language summaries of OpenAI's categories, not community violation rules.
// Source: https://developers.openai.com/api/docs/guides/moderation (2026-10-30).
export const MODERATION_CATEGORIES = [
  {key:'harassment',label:'Harassment',description:'Abuse directed at someone.'},
  {key:'harassment/threatening',label:'Threatening harassment',description:'Targeted abuse involving threats of serious injury or violence.'},
  {key:'hate',label:'Hate',description:'Attacks based on protected characteristics, including race, religion, gender or disability.'},
  {key:'hate/threatening',label:'Threatening hate',description:'Such attacks involving threats of violence or serious injury.'},
  {key:'illicit',label:'Illegal activity instructions',description:'Guidance for carrying out unlawful actions.'},
  {key:'illicit/violent',label:'Violent illegal activity instructions',description:'Unlawful guidance involving violence or obtaining weapons.'},
  {key:'self-harm',label:'Self-harm',description:'Portrayals or promotion of harming oneself.'},
  {key:'self-harm/intent',label:'Self-harm intent',description:'Someone describing current or intended harm to themselves.'},
  {key:'self-harm/instructions',label:'Self-harm instructions',description:'Advice or encouragement to harm oneself.'},
  {key:'sexual',label:'Sexual content',description:'Arousing material or promotion of sexual services; excludes sexual-health education.'},
  {key:'sexual/minors',label:'Sexual content involving minors',description:'Sexual material involving people younger than 18.'},
  {key:'violence',label:'Violence',description:'Portrayals of death, injury or violent acts.'},
  {key:'violence/graphic',label:'Graphic violence',description:'Vivid, explicit portrayals of death, injury or violence.'},
];
