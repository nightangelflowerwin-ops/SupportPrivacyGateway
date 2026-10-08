'use strict';
const $ = id => document.getElementById(id);
const sample = $('ticket').value;
let session;
async function init(){
  const response = await fetch('/lab/session');
  if(!response.ok) throw new Error('Local gateway unavailable');
  const data = await response.json(); session = data.session;
  $('detector').textContent = data.detector === 'validators' ? 'Validators only: names and addresses can be missed' : `Local detector: ${data.detector} + validators`;
}
$('sample').addEventListener('click', () => {$('ticket').value = sample;});
$('run').addEventListener('click', async () => {
  $('run').disabled = true; $('error').textContent = '';
  for(const id of ['protected','masked','restored','simulated']) $(id).textContent = '';
  $('entities-count').textContent = '0'; $('restored-count').textContent = '0'; $('labels').replaceChildren();
  try {
    if(!session) await init();
    const response = await fetch('/lab/run', {method:'POST',headers:{'Content-Type':'application/json','X-Lab-Session':session},body:JSON.stringify({text:$('ticket').value,policy:$('policy').value})});
    if(!response.ok) throw new Error('Protection failed. No result was returned. Check the local gateway and input.');
    const data = await response.json();
    for(const [id,key] of Object.entries({protected:'redacted',masked:'masked',restored:'restored_reply',simulated:'simulated_reply'})) $(id).textContent = data[key];
    $('entities-count').textContent = data.entities.length; $('restored-count').textContent = data.tokens_restored;
    for(const label of [...new Set(data.entities.map(e=>e.label))]) {const chip=document.createElement('span');chip.className='tag';chip.textContent=label;$('labels').append(chip);}
    if(!data.entities.length) $('labels').textContent='No spans detected. This does not prove that no personal information is present.';
  } catch(error) {$('error').textContent=error.message;} finally {$('run').disabled=false;}
});
init().catch(()=>{$('detector').textContent='Local gateway unavailable';});
