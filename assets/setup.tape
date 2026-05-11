# kanboard-mcp setup recording — renders assets/setup.gif from assets/setup.sh.
#
# Re-render with:  vhs assets/setup.tape
#
# Requires:        vhs (https://github.com/charmbracelet/vhs)

Output assets/setup.gif

Set FontSize 16
Set Width 1100
Set Height 720
Set Theme "Catppuccin Mocha"
Set Padding 28
Set TypingSpeed 0ms
Set PlaybackSpeed 1.0

# Skip the command-typing — we want only the simulated session on screen.
Hide
Type "bash assets/setup.sh"
Enter
Show

# The script paces itself; we just wait for it to finish.
Sleep 14s
