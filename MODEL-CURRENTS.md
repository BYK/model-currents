# Model Currents v1 compatibility

Model Tides accepts existing Model Currents v1 JSON files with `"format": "model-currents"`. It validates and converts them to the [Model Tides v1 format](MODEL-TIDES.md) in browser memory. **Export metadata JSON** saves the new format. Old JSON files remain usable without changing their timestamps or event counts.
