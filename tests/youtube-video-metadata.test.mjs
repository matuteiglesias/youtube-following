import assert from "node:assert/strict";
import test from "node:test";
import {isoDurationSeconds,fetchCurrentVideoMetadata} from "../src/lib/providers/youtube-video-metadata.ts";

test("YouTube ISO duration parser treats missing, scheduled, and zero durations as unknown",()=>{
  assert.equal(isoDurationSeconds("PT13M49S"),829);
  assert.equal(isoDurationSeconds("PT1H2M3S"),3723);
  assert.equal(isoDurationSeconds("P1DT2H"),93600);
  for (const s of ["PT0S","P0D","invalid",null,undefined]) assert.equal(isoDurationSeconds(s),null);
});
test("a completed public video is eligible for metadata enrichment with validated canonical id",async()=>{
  const calls=[];
  const fetcher=async(url,opts)=>{
    calls.push([url.href,Boolean(opts.signal)]);
    return new Response(JSON.stringify({items:[{
      id:"abcdefghijk",
      snippet:{liveBroadcastContent:"none",thumbnails:{medium:{url:"https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg"}}},
      contentDetails:{duration:"PT13M49S"},status:{privacyStatus:"public"},
    }]}),{status:200});
  };
  const result=await fetchCurrentVideoMetadata("youtube:abcdefghijk","provider-test-key",fetcher);
  assert.deepEqual(result,{duration_seconds:829,live_status:"completed",availability:"public",
    thumbnail_url:"https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg"});
  assert.equal(calls.length,1);
  assert.ok(calls[0][0].includes("part=snippet%2CcontentDetails%2Cstatus%2CliveStreamingDetails"));
  assert.ok(calls[0][1]);
  assert.equal(await fetchCurrentVideoMetadata("bad:abcdefghijk","provider-test-key",fetcher),null);
  assert.equal(calls.length,1);
});
test("planned live events are not described as completed video, and failures return no metadata",async()=>{
  const live=await fetchCurrentVideoMetadata("youtube:abcdefghijk","key",async()=>new Response(JSON.stringify({items:[{
    id:"abcdefghijk",snippet:{liveBroadcastContent:"upcoming"},
    contentDetails:{duration:"PT0S"},status:{privacyStatus:"public"},
    liveStreamingDetails:{scheduledStartTime:"2099-01-01T00:00:00Z"},
  }]}),{status:200}));
  assert.equal(live.live_status,"upcoming");
  assert.equal(live.duration_seconds,null);
  assert.equal(await fetchCurrentVideoMetadata("youtube:abcdefghijk","key",
    async()=>new Response("quota exceeded",{status:403})),null);
});
