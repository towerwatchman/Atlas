import re
import os

def sanitize_folder_name(name):
    """Replace invalid characters in folder names."""
    return re.sub(r'[\\/:*?"<>|]', '_', name)

# Hardcoded list of 100 games from SteamDB Ren'Py page with min_reviews=100
# App IDs and titles from provided table (first 50) and extended list
# Developers sourced from Steam store pages; publishers used if developer is unknown
games = [
    {"appid": "1129190", "title": "Our Life: Beginnings & Always", "developer": "GB Patch Games"},
    {"appid": "698780", "title": "Doki Doki Literature Club!", "developer": "Team Salvato"},
    {"appid": "2415010", "title": "A Date with Death", "developer": "Two and a Half Studios"},
    {"appid": "1989270", "title": "Slay the Princess — The Pristine Cut", "developer": "Black Tabby Games"},
    {"appid": "1895350", "title": "I Wani Hug that Gator!", "developer": "Cavemanon"},
    {"appid": "1392820", "title": "Milk inside a bag of milk inside a bag of milk", "developer": "Nikita Kryukov"},
    {"appid": "1604000", "title": "Milk outside a bag of milk outside a bag of milk", "developer": "Nikita Kryukov"},
    {"appid": "1764390", "title": "BAD END THEATER", "developer": "NomnomNami"},
    {"appid": "1609230", "title": "Scarlet Hollow", "developer": "Black Tabby Games"},
    {"appid": "3068300", "title": "Katawa Shoujo", "developer": "Four Leaf Studios"},
    {"appid": "1421250", "title": "Tiny Bunny", "developer": "Saikono"},
    {"appid": "1714320", "title": "Find Love or Die Trying", "developer": "Audimeow"},
    {"appid": "1126320", "title": "Being a DIK - Season 1", "developer": "Dr PinkCake"},
    {"appid": "2318310", "title": "Class of '09: The Re-Up", "developer": "SBN3"},
    {"appid": "2443110", "title": "South Scrimshaw, Part One", "developer": "Nathan O. Marsh"},
    {"appid": "1765350", "title": "候鸟", "developer": "BBX"},  # Publisher used
    {"appid": "1997680", "title": "REFLEXIA Prototype ver.", "developer": "mahoumaiden"},
    {"appid": "331470", "title": "Everlasting Summer", "developer": "Soviet Games"},
    {"appid": "1641270", "title": "枝江往事", "developer": "枝江往事开发组"},  # Developer from Steam
    {"appid": "1350650", "title": "FreshWomen - Season 1", "developer": "OppaiMan"},
    {"appid": "1232180", "title": "Sakuya Izayoi Gives You Advice And Dabs", "developer": "Sigyaad Team"},
    {"appid": "3515380", "title": "YKMET: Strade", "developer": "Gatobob"},
    {"appid": "3378000", "title": "Nigudin really fought against Furong Wangyuan", "developer": "Hikigeki"},  # Publisher used
    {"appid": "1532510", "title": "Purrfect Apawcalypse: Love at Furst Bite", "developer": "90% Studios"},
    {"appid": "568770", "title": "Cinderella Phenomenon - Otome/Visual Novel", "developer": "Dicesuki"},
    {"appid": "2112520", "title": "her tears were my light", "developer": "NomnomNami"},
    {"appid": "1045520", "title": "Acting Lessons", "developer": "Dr PinkCake"},
    {"appid": "1688580", "title": "A YEAR OF SPRINGS", "developer": "npckc"},
    {"appid": "2403320", "title": "冬日树下的回忆(Memories of the Winter Tree)", "developer": "Unknown"},  # Publisher not clear
    {"appid": "1443200", "title": "Class of '09", "developer": "SBN3"},
    {"appid": "344770", "title": "fault - milestone two side:above", "developer": "ALICE IN DISSONANCE"},
    {"appid": "251990", "title": "Long Live The Queen", "developer": "Hanako Games"},
    {"appid": "1768640", "title": "Leap of Faith", "developer": "DriftyGames"},
    {"appid": "1430420", "title": "CBT With Yuuka Kazami", "developer": "Sigyaad Team"},
    {"appid": "2899050", "title": "Desert Stalker", "developer": "Zetan"},
    {"appid": "571880", "title": "Angels with Scaly Wings™ / 鱗羽の天使", "developer": "Radical Phi"},
    {"appid": "1111370", "title": "A Summer's End - Hong Kong 1986", "developer": "Oracle and Bone"},
    {"appid": "1173010", "title": "Flowers Blooming at the End of Summer", "developer": "Midsummer Studio"},  # Publisher used
    {"appid": "3585630", "title": "this game will end in 205 clicks.", "developer": "Unknown"},  # Publisher not clear
    {"appid": "402620", "title": "Kindred Spirits on the Roof", "developer": "Liar-soft"},
    {"appid": "917680", "title": "one night, hot springs", "developer": "npckc"},
    {"appid": "3069120", "title": "Love Curse: Find Your Soulmate", "developer": "Unknown"},  # Publisher not clear
    {"appid": "2910460", "title": "Furry Angel Take In", "developer": "Unknown"},  # Publisher not clear
    {"appid": "1578860", "title": "Billionaire Lovers", "developer": "Unknown"},  # Publisher not clear
    {"appid": "753220", "title": "Mhakna Gramura and Fairy Bell", "developer": "ALICE IN DISSONANCE"},
    {"appid": "1155970", "title": "Roadwarden", "developer": "Moral Anxiety Studio"},
    {"appid": "1708110", "title": "Misericorde: Volume One", "developer": "Xeecee"},
    {"appid": "1249880", "title": "Tiny Bunny: Prologue", "developer": "Saikono"},
    {"appid": "926340", "title": "Roman's Christmas / 罗曼圣诞探案集", "developer": "Unknown"},  # Publisher not clear
    {"appid": "353330", "title": "Love at First Sight", "developer": "Creepster"},
    {"appid": "1639610", "title": "Save Me, Sakuya-san!", "developer": "Sigyaad Team"},
    {"appid": "1599470", "title": "Purrfect Apawcalypse: Patches' Infurno", "developer": "90% Studios"},
    {"appid": "1822190", "title": "Momotype", "developer": "Sakevisual"},
    {"appid": "1559430", "title": "Purrfect Apawcalypse: Purrgatory Furever", "developer": "90% Studios"},
    {"appid": "1044490", "title": "The Expression Amrilato", "developer": "SukeraSparo"},
    {"appid": "1299370", "title": "Friendship with Benefits", "developer": "Hunny Bunny Studio"},
    {"appid": "2342920", "title": "OBSCURA", "developer": "Foxglove Games"},
    {"appid": "1126310", "title": "风信楼", "developer": "Unknown"},  # Publisher not clear
    {"appid": "2386250", "title": "It gets so lonely here", "developer": "ebi-hime"},
    {"appid": "2266820", "title": "Lilith Wants to Buy Your Soul", "developer": "ebi-hime"},
    {"appid": "642090", "title": "Coming Out on Top", "developer": "Obscura"},
    {"appid": "1769320", "title": "Athanasy", "developer": "Wirion"},
    {"appid": "710710", "title": "Pizza Game", "developer": "Plasterbrain"},
    {"appid": "1058000", "title": "Rain's love memory-雨的恋记", "developer": "Unknown"},  # Publisher not clear
    {"appid": "1406040", "title": "Scarlet Hollow — Episode 1", "developer": "Black Tabby Games"},
    {"appid": "3574510", "title": "Serre", "developer": "ebi-hime"},
    {"appid": "1940040", "title": "The Price Of Flesh", "developer": "Gatobob"},
    {"appid": "1296770", "title": "Her New Memory - Hentai Simulator", "developer": "Zodiacus Games"},
    {"appid": "1883090", "title": "The Symbiant", "developer": "HeartCoreDev"},
    {"appid": "2392230", "title": "The Groom of Gallagher Mansion", "developer": "SicklyDove Games"},
    {"appid": "396650", "title": "ACE Academy", "developer": "PixelFade"},
    {"appid": "1719310", "title": "Love Sucks: Night Two", "developer": "Art Witch Studios"},
    {"appid": "1194740", "title": "MetaWare High School", "developer": "Not Fun Games"},
    {"appid": "451760", "title": "Highway Blossoms", "developer": "Studio Élan"},
    {"appid": "2936180", "title": "茜色", "developer": "Unknown"},  # Publisher not clear
    {"appid": "2302140", "title": "q.u.q.", "developer": "Akihabara Games"},
    {"appid": "3100210", "title": "My Sweet! Housemate", "developer": "Unknown"},  # Publisher not clear
    {"appid": "2173800", "title": "Projekt: Passion - Season 1", "developer": "Classy Lemon"},
    {"appid": "2538910", "title": "夏末白夜", "developer": "Unknown"},  # Publisher not clear
    {"appid": "2615670", "title": "Bewitching Sinners", "developer": "Critical Bliss"},
    {"appid": "1223810", "title": "Full Service", "developer": "HZL"},
    {"appid": "3035990", "title": "Misericorde Volume Two: White Wool & Snow", "developer": "Xeecee"},
    {"appid": "822930", "title": "Wolf Tails", "developer": "Razzart Visual"},
    {"appid": "2160000", "title": "Trapped with Jester", "developer": "Miggy Jagger"},
    {"appid": "2066550", "title": "ERROR143", "developer": "Jenny Vi Pham"},
    {"appid": "516600", "title": "Bai Qu: Hundreds of Melodies", "developer": "Magenta Factory"},
    {"appid": "2976720", "title": "1 to 1 humanoid edible toys", "developer": "Unknown"},  # Publisher not clear
    {"appid": "1724190", "title": "Come Home", "developer": "R.J. Rhodes"},
    {"appid": "1450150", "title": "Durka Simulator", "developer": "Kopskop Games"},
    {"appid": "3011560", "title": "City Lights Love Bites Season 0 [Pilot Season]", "developer": "Unknown"},  # Publisher not clear
    {"appid": "3224310", "title": "you're just imagining it", "developer": "Unknown"},  # Publisher not clear
    {"appid": "570840", "title": "家有大貓 Nekojishi", "developer": "Studio Klondike"},
    {"appid": "2992240", "title": "Banebush", "developer": "Unknown"},  # Publisher not clear
    {"appid": "844660", "title": "Heart of the Woods", "developer": "Studio Élan"},
    {"appid": "2738080", "title": "Ignited in Cavern", "developer": "Unknown"},  # Publisher not clear
    {"appid": "594130", "title": "Winds of Change", "developer": "Klace"}
]

# Process up to 100 games, skipping demos
games_collected = 0
root_dir = "games"

for game in games[:100]:
    if games_collected >= 100:
        break
    
    appid = game["appid"]
    title = game["title"]
    developer = game["developer"]
    
    # Skip if it's a demo (based on title)
    if "Demo" in title:
        continue
    
    # Create folder structure: games/Developer/Title/AppID
    dev_dir = sanitize_folder_name(developer)
    title_dir = sanitize_folder_name(title)
    appid_dir = appid
    
    try:
        base_path = os.path.join(root_dir, dev_dir, title_dir, appid_dir)
        os.makedirs(base_path, exist_ok=True)
        
        # Create dummy .exe file
        exe_path = os.path.join(base_path, 'dummy.swf')
        with open(exe_path, 'w') as f:
            f.write('')  # Empty file
        
        print(f"Created directory for '{title}' (AppID: {appid}) by '{developer}'")
        games_collected += 1
    except Exception as e:
        print(f"Error creating directory for '{title}' (AppID: {appid}): {e}")

print(f"Finished creating directories for {games_collected} games.")