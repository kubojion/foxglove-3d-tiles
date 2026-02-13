#!/usr/bin/env python3
"""
Generic CORS-enabled HTTP server for serving URDF mesh files to Foxglove.

Usage:
    # Option 1: Serve current directory (Standard usage)
    python3 serve_meshes.py

    # Option 2: Serve a specific directory
    python3 serve_meshes.py --directory /path/to/my_robot_description

    # Option 3: Find and serve a specific installed ROS 2 package
    python3 serve_meshes.py --package my_robot_description

The extension requests meshes at URLs like:
    http://localhost:9090/package_name/meshes/base_link.STL

This maps to:
    package://package_name/meshes/base_link.STL
"""
import http.server
import socketserver
import argparse
import os
import subprocess
import sys


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with CORS headers to allow Foxglove (web/desktop) to fetch files."""

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        # Reduce noise: Only log errors (4xx, 5xx) or startup messages
        # Filter out successful 200 OK logs to keep terminal clean
        if args and "200" not in str(args[1] if len(args) > 1 else ""):
            super().log_message(format, *args)


def find_package_path(package_name: str) -> str:
    """Try to find a ROS 2 package source/share path using standard tools."""
    print(f"[*] Searching for ROS package '{package_name}'...")
    
    # Method 1: Use 'ros2 pkg prefix' (Works for source and installed packages)
    try:
        result = subprocess.run(
            ["ros2", "pkg", "prefix", package_name],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            prefix = result.stdout.strip()
            # If it's an installed package (in /opt/ros or install/), content is often in share/
            share_path = os.path.join(prefix, "share", package_name)
            if os.path.isdir(share_path):
                return share_path
            # If it's a source package (symlinked), the prefix might be the path itself
            if os.path.isdir(prefix):
                return prefix
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    # Method 2: Check standard environment variables
    ament_prefix = os.environ.get("AMENT_PREFIX_PATH", "")
    for path in ament_prefix.split(os.pathsep):
        candidate = os.path.join(path, "share", package_name)
        if os.path.isdir(candidate):
            return candidate

    return ""


def main():
    parser = argparse.ArgumentParser(
        description="Serve URDF mesh files with CORS for Foxglove extensions."
    )
    parser.add_argument(
        "--port", type=int, default=9090, help="HTTP server port (default: 9090)"
    )
    parser.add_argument(
        "--directory",
        type=str,
        default=".",
        help="Directory to serve (default: current directory '.')",
    )
    parser.add_argument(
        "--package",
        type=str,
        help="Optional: ROS 2 package name to find and serve automatically",
    )
    args = parser.parse_args()

    # Determine which directory to serve
    if args.package:
        serve_dir = find_package_path(args.package)
        if not serve_dir:
            print(f"Error: Could not find ROS package '{args.package}'.")
            print("Make sure you have sourced your ROS workspace (source install/setup.bash).")
            sys.exit(1)
    else:
        serve_dir = args.directory

    # Validate directory
    if not os.path.isdir(serve_dir):
        print(f"Error: Directory does not exist: {serve_dir}")
        sys.exit(1)

    # Change to that directory so it becomes the server root
    os.chdir(serve_dir)
    serve_dir_abs = os.getcwd()

    # Setup Server
    with socketserver.TCPServer(("", args.port), CORSHandler) as httpd:
        print(f"\n{'='*60}")
        print(f"  FOXGLOVE MESH SERVER")
        print(f"  Serving Directory: {serve_dir_abs}")
        print(f"  URL:               http://localhost:{args.port}")
        print(f"{'='*60}")
        print(f"\n[Usage Hint]")
        print(f"If your URDF has: package://my_robot/meshes/wheel.stl")
        print(f"It will load from: http://localhost:{args.port}/my_robot/meshes/wheel.stl")
        print(f"\nEnsure you are running this script from the folder containing 'my_robot'!")
        print(f"Press Ctrl+C to stop.\n")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()