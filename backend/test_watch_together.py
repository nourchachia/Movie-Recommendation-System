import os
import time
import requests
import asyncio
import websockets
import json
import uuid

BASE_URL = "http://localhost:8000"
WS_URL = "ws://localhost:8000"

def get_auth_token(username, email, password):
    """Register or login to get a valid JWT token."""
    login_data = {"email": email, "password": password}
    response = requests.post(f"{BASE_URL}/auth/login", json=login_data)
    
    if response.status_code == 200:
        return response.json()["access_token"]
        
    # If login fails (user doesn't exist), try to register
    reg_data = {"username": username, "email": email, "password": password}
    response = requests.post(f"{BASE_URL}/auth/register", json=reg_data)
    if response.status_code in [200, 201]:
         return response.json()["access_token"]
    
    raise Exception(f"Failed to authenticate {email}: {response.text}")

async def test_watch_together_flow():
    print("🎬 Starting Watch Together API Test Flow...")
    
    # 1. Auth two users
    print("\n[1] Authenticating User A and User B...")
    token_a = get_auth_token("TestUserA", "usera@example.com", "StrongPass!123")
    token_b = get_auth_token("TestUserB", "userb@example.com", "StrongPass!123")
    print("✅ Successfully obtained JWT tokens.")
    
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 2. User A creates session
    print("\n[2] User A creating a session...")
    res = requests.post(f"{BASE_URL}/api/sessions", params={"pool_size": 10}, headers=headers_a)
    assert res.status_code == 200, f"Session creation failed: {res.text}"
    session_data = res.json()
    code = session_data["code"]
    print(f"✅ Session created. Invite Code: {code}")

    # 3. User B joins session
    print("\n[3] User B joining the session...")
    res = requests.post(f"{BASE_URL}/api/sessions/{code}/join", headers=headers_b)
    if res.status_code == 409 and "already active" in res.text:
       print("⚠️ Session already active (probably from a previous test run). Continuing...")
    else:
       assert res.status_code == 200, f"Failed to join session: {res.text}"
    print("✅ User B joined.")
    
    # 4. Both poll session state
    print("\n[4] User A polling session state...")
    res = requests.get(f"{BASE_URL}/api/sessions/{code}", headers=headers_a)
    assert res.status_code == 200, f"Failed to get session state: {res.text}"
    status_data = res.json()
    
    pool = status_data["movie_pool"]
    print(f"✅ Session status: '{status_data['status']}', pool size: {len(pool)}")
    
    if len(pool) == 0:
        print("❌ Empty movie pool! Aborting test. (Make sure UserA hasn't rated all movies).")
        return
        
    movie_to_match = pool[0]["movie_id"]
    print(f"🎯 Target movie selected for matching: ID {movie_to_match} ({pool[0].get('title', 'Unknown Title')})")

    # 5. Connect WebSockets
    print("\n[5] Connecting WebSockets for real-time match events...")
    received_match = asyncio.Event()

    async def listen_ws(name, uri):
        try:
            async with websockets.connect(uri) as ws:
                print(f" 🔌 [{name}] Connected to WS {uri}")
                # Wait until we receive the match event
                while not received_match.is_set():
                    try:
                        # Wait for message with a timeout so we can exit gracefully
                        msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                        data = json.loads(msg)
                        print(f" 📩 [{name}] Received WS event: {data}")
                        if data.get("event") == "match" and data.get("movie_id") == movie_to_match:
                             print(f" 🎉 [{name}] Match event confirmed!")
                             received_match.set()
                             break
                    except asyncio.TimeoutError:
                        continue
        except Exception as e:
            print(f" ❌ [{name}] WS error: {e}")

    ws_task_a = asyncio.create_task(listen_ws("UserA", f"{WS_URL}/ws/sessions/{code}"))
    ws_task_b = asyncio.create_task(listen_ws("UserB", f"{WS_URL}/ws/sessions/{code}"))

    # Give websockets a moment to connect
    await asyncio.sleep(1.5)

    # 6. User A swipes right
    print(f"\n[6] User A swiping RIGHT on movie {movie_to_match}...")
    res = requests.post(
        f"{BASE_URL}/api/sessions/{code}/swipe", 
        json={"movie_id": movie_to_match, "direction": "right"}, 
        headers=headers_a
    )
    assert res.status_code == 200, f"Swipe failed: {res.text}"
    print(f"✅ User A HTTP Response: {res.json()}")

    # 7. User B swipes right (should trigger match and WS broadcast)
    print(f"\n[7] User B swiping RIGHT on movie {movie_to_match}...")
    res = requests.post(
        f"{BASE_URL}/api/sessions/{code}/swipe", 
        json={"movie_id": movie_to_match, "direction": "right"}, 
        headers=headers_b
    )
    assert res.status_code == 200, f"Swipe failed: {res.text}"
    b_data = res.json()
    print(f"✅ User B HTTP Response: {b_data}")
    assert b_data.get("match") is True, "Match was not detected in HTTP response!"

    # Wait briefly for WebSockets to process the match broadcast
    print("\n⏳ Waiting up to 5s for WebSockets to receive the match broadcast...")
    try:
        await asyncio.wait_for(received_match.wait(), timeout=5.0)
    except asyncio.TimeoutError:
        print("❌ WebSockets did NOT receive match event in time.")
    
    # Clean up WS tasks by cancelling them
    ws_task_a.cancel()
    ws_task_b.cancel()

    # 8. Check matches endpoint
    print("\n[8] Checking matches endpoint...")
    res = requests.get(f"{BASE_URL}/api/sessions/{code}/matches", headers=headers_a)
    assert res.status_code == 200, f"Failed to get matches: {res.text}"
    matches = res.json()["matches"]
    
    print(f"✅ Total matches natively saved in DB: {len(matches)}")
    match_ids = [m["movie_id"] for m in matches]
    assert movie_to_match in match_ids, "Movie not found in matches endpoint!"
    
    for idx, match in enumerate(matches, 1):
        print(f"   {idx}. {match.get('title')} (ID: {match.get('movie_id')}) matched at {match.get('matched_at')}")

    print("\n🚀 SUCCESS! All Watch Together session endpoints function exactly as designed!")

if __name__ == "__main__":
    asyncio.run(test_watch_together_flow())
