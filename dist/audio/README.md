Place pre-generated mp3 files here. Filenames should match the `audio` field in src/data/lights.json (e.g., q1_kaideng.mp3).

How to generate audio files before building (examples):

1) Using Edge TTS (Python package) locally to generate offline mp3s:
   - pip install edge-tts
   - python -m edge_tts "请开启前照灯" --voice zh-CN-YunxiNeural -o q1_kaideng.mp3
   - Repeat for each phrase and move files to public/audio/

2) Using Azure/Google TTS services (requires credentials):
   - Use the provider's CLI or SDK to synthesize phrases and save as mp3.

3) If you do not provide audio files, the app will fall back to browser TTS (SpeechSynthesis) at runtime.

After placing files, rebuild the app (npm run build) so audio files are included in the build output.
