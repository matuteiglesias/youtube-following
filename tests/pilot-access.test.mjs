import assert from "node:assert/strict";
import test from "node:test";
import { activatePilotTrial } from "../src/lib/pilot-access.ts";

function deps(overrides={}) {
  const calls = [];
  return {
    calls, email:"pilot@example.test", userId:"one-user", emailConfirmed:true,
    operatorEmail:"PILOT@example.test",
    loadEntitlement:async()=>({plan_code:"none",status:"none"}),
    grant:async(id)=>{calls.push(id);},
    ...overrides,
  };
}
test("only the operator-allowlisted confirmed account can receive a bounded pilot trial",async()=>{
  const eligible=deps();
  assert.equal(await activatePilotTrial(eligible),"activated");
  assert.deepEqual(eligible.calls,["one-user"]);
  for(const override of [
    {email:"other@example.test"}, {emailConfirmed:false}, {operatorEmail:undefined},
    {loadEntitlement:async()=>({plan_code:"paid",status:"active"})},
    {loadEntitlement:async()=>({plan_code:"none",status:"past_due"})},
  ]) {
    const invalid=deps(override);
    assert.equal(await activatePilotTrial(invalid),"not_eligible");
    assert.equal(invalid.calls.length,0);
  }
});
test("replaying trial while internal test remains active does not reset credit budget",async()=>{
  const existing=deps({loadEntitlement:async()=>({plan_code:"internal_test",status:"active"})});
  assert.equal(await activatePilotTrial(existing),"already_active");
  assert.equal(existing.calls.length,0);
});
