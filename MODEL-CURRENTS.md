# Model Currents v1 compatibility

The local Model Tides CLI accepts existing Model Currents v1 JSON files with `"format": "model-currents"`. It validates and converts them to the [Model Tides v1 format](MODEL-TIDES.md) in memory. Pass old files to `upload --input` or `gist --input` to review weekly counts before sharing; the website does not import event metadata.
