"""Phase 12 — Python SDK parity, run against the live isolated API."""
import json, pathlib, sys
from raven import Raven, CreateConversationParams, ConversationMember, CreateChatTokenParams, SendChatMessageParams, ListChatMessagesParams

ctx = json.loads(pathlib.Path(__file__).with_name("ctx.json").read_text())
raven = Raven(api_key=ctx["apiKey"], base_url=ctx["base"])
S = "p12py" + __import__("time").strftime("%H%M%S")
results = []
def check(name, fn):
    try:
        fn(); results.append((name, True, "")); print(f"  PASS  {name}")
    except Exception as e:
        results.append((name, False, str(e))); print(f"  FAIL  {name} — {e}")

state = {}
def create():
    c = raven.chat.create_conversation(CreateConversationParams(
        name=S, members=[ConversationMember(user_id="alice"), ConversationMember(user_id="bob")]))
    state["room"] = c["publicId"]; assert c["publicId"].startswith("conv_")
def token():
    t = raven.chat.create_token(CreateChatTokenParams(user_id="alice", conversations=[state["room"]]))
    state["grant"] = t
    assert t["token"] and t["chatUrl"] and t["apiUrl"], "grant has token+chatUrl+apiUrl"
    assert t["userId"] == "alice"
def send():
    m = raven.chat.send_message(state["room"], SendChatMessageParams(sender_id="alice", text="hello from python"))
    state["msg"] = m; assert m["id"].startswith("msg_"); assert m["senderId"] == "alice"
def system_message():
    m = raven.chat.send_message(state["room"], SendChatMessageParams(sender_id="alice", text="server announcement", type="system"))
    assert m["type"] == "system", f"got {m['type']}"
def history():
    p = raven.chat.list_messages(state["room"], ListChatMessagesParams(limit=10))
    assert len(p["data"]) == 2, f"expected 2, got {len(p['data'])}"
    assert p["data"][-1]["text"] == "hello from python"
def members():
    raven.chat.add_member(state["room"], "carol")
    ms = raven.chat.list_members(state["room"])
    assert sorted(m["userId"] for m in ms) == ["alice", "bob", "carol"], ms
    raven.chat.remove_member(state["room"], "carol")
    ms = raven.chat.list_members(state["room"])
    assert sorted(m["userId"] for m in ms) == ["alice", "bob"]
def get_conv():
    c = raven.chat.get_conversation(state["room"]); assert c["publicId"] == state["room"]
def list_convs():
    cs = raven.chat.list_conversations(); assert any(c["publicId"] == state["room"] for c in cs)
def delete_msg():
    d = raven.chat.delete_message(state["msg"]["id"])
    assert d["deleted"] is True and d["text"] is None, d
def no_realtime():
    assert not hasattr(raven.chat, "connect"), "python SDK must not claim a realtime surface"
    assert not hasattr(raven.chat, "subscribe")
    surface = [n for n in dir(raven.chat) if not n.startswith("_")]
    print(f"        · python chat surface: {surface}")
def no_presence_typing_reactions_readstate():
    missing = [n for n in ("get_presence", "list_presence", "add_reaction", "mark_read", "get_read_state") if not hasattr(raven.chat, n)]
    print(f"        · NOT implemented in the Python SDK: {missing}")
    assert len(missing) == 5

for n, f in [("create conversation", create), ("get conversation", get_conv), ("list conversations", list_convs),
             ("mint chat token", token), ("send message", send), ("send system message (server-only)", system_message),
             ("list history", history), ("add/remove member", members), ("soft-delete message", delete_msg),
             ("no realtime surface (by design)", no_realtime),
             ("presence/typing/reactions/read-state absent (documented gap)", no_presence_typing_reactions_readstate)]:
    check(n, f)

ok = sum(1 for _, o, _ in results if o)
print(f"\n=== PHASE 12 (Python SDK): {ok}/{len(results)} passed ===")
for n, o, e in results:
    if not o: print(f"  FAILED: {n} — {e}")
sys.exit(0 if ok == len(results) else 1)
