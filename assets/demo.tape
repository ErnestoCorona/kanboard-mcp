# kanboard-mcp demo recording — renders assets/demo.gif from assets/demo.sh.
#
# Re-render with:  vhs assets/demo.tape
#
# Requires:        vhs (https://github.com/charmbracelet/vhs)

Output assets/demo.gif

Set FontSize 16
Set Width 1100
Set Height 540
Set Theme "Catppuccin Mocha"
Set Padding 28
Set TypingSpeed 0ms
Set PlaybackSpeed 1.0

# Skip the command-typing — we want only the simulated session on screen.
Hide
Type "bash assets/demo.sh"
Enter
Show

# The script paces itself; we just wait for it to finish.
Sleep 16s
