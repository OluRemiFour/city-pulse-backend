import 'dotenv/config';
import { supabase } from "../db/supabase.js";
async function checkMapData() {
    try {
        const { data, error } = await supabase
            .from('complaints_with_analysis')
            .select('id, lat, lng, neighborhood, category')
            .limit(10);
        if (error)
            throw error;
        const fs = await import('fs');
        let output = "Map Data Sample (lat/lng check):\n";
        if (!data || data.length === 0) {
            output += "No data found in complaints_with_analysis\n";
        }
        else {
            for (const row of data) {
                output += `POINT: ${row.lat}, ${row.lng} | NEIGHBORHOOD: ${row.neighborhood}\n`;
            }
        }
        fs.writeFileSync('map_debug.log', output);
        console.log("Logged to map_debug.log");
    }
    catch (err) {
        console.error("Error checking map data:", err);
    }
}
checkMapData();
