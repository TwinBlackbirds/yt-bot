from multiprocessing import Process

import sys
import subprocess
import time

def start_bot():
    subprocess.call(["/usr/bin/node", ".", "-t", "0"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def main():
    if len(sys.argv) < 2:
        print("Incorrect usage!")
        print("Usage: python scheduler.py <url>")
        sys.exit(1)

    amount = sys.argv[1]

    children = []

    for i in range(int(amount)):
        p = Process(target=start_bot)
        p.start()
        print(f"started bot #{i+1}")
        time.sleep(1)
        children.append(p)

    print("bots are running")
    # await procs
    for p in children:
        p.join()

    print("all commands executed")


if __name__ == '__main__':
    main()