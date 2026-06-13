
import os

directory = r"c:\Users\Subhankar Roy\Downloads\MeatDae"
target_number = "tel:+917002568330"

print(f"Scanning directory: {directory}")

for filename in os.listdir(directory):
    if filename.endswith(".html"):
        filepath = os.path.join(directory, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()

            new_content = content.replace("callto:123456789", target_number)
            new_content = new_content.replace("callto:+917002568330", target_number)

            if content != new_content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated: {filename}")
            else:
                print(f"No changes needed: {filename}")

        except Exception as e:
            print(f"Error processing {filename}: {e}")
