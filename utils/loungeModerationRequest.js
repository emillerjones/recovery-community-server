// Shared by durable checks and the ephemeral Owner test. Never log member text.
export async function requestModeration(text, {fetchImpl=fetch}={}) {
  let response;
  try {
    response=await fetchImpl('https://api.openai.com/v1/moderations',{
      method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:'omni-moderation-latest',input:text}),signal:AbortSignal.timeout(20_000),
    });
  }catch{throw new Error('API network error or timeout');}
  if(!response.ok)throw new Error(`API HTTP ${response.status}`);
  try{return await response.json();}catch{throw new Error('Invalid API JSON');}
}
